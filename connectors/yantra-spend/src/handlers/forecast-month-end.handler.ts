import { gbpPerUsd, usdToGbp } from "../fx/fx.js";
import { allSources } from "../sources/registry.js";
import { CostLine, Currency, Source } from "../types/cost-line.js";
import { YantraSpendClientResponse } from "../types/client-response.js";
import { formatError } from "../helpers/format-error.js";

export interface ForecastArgs {
  currency: Currency;
  /**
   * When true, include the provider-original `raw` blob on every forecast
   * entry. Default false. AWS forecast raw carries `$metadata`,
   * `ForecastResultsByTime` (with PredictionIntervalLowerBound /
   * UpperBound), and `Total` — useful for byte-identical reconciliation but
   * noisy in the default response.
   */
  include_raw?: boolean;
}

/** Why a source has no entry in `forecasts`. */
export interface SkippedForecastSource {
  source: Source;
  reason: string;
}

/**
 * Per-source month-end forecast.
 *
 * Every source absent from `forecasts` is accounted for in the LEADING
 * `sources_skipped` array with a reason — a partial forecast must never look
 * complete. Reasons: "skipped (no credentials)", "unsupported" (gcp),
 * "no forecast available (source does not support forecasting, or provider
 * returned none)", or "api error (see warnings)".
 *
 * Forecasts are supported for AWS (Cost Explorer GetCostForecast) and
 * Azure (Cost Management Forecast). The two DIFFER in what the amount
 * covers — each entry carries a `forecast_basis` label:
 *   - AWS: projected FULL current calendar month (month-to-date actuals
 *     baked in; period_start = first of month).
 *   - Azure: projected remaining spend today→month-end, excluding actuals
 *     to date (period_start = today).
 *
 * The provider-original `raw` blob is stripped by default to match the
 * spend_summary / spend_by_source / top_movers convention; pass
 * `include_raw=true` to attach it.
 */
export async function forecastMonthEnd(
  args: ForecastArgs,
): Promise<
  YantraSpendClientResponse<{
    sources_skipped: SkippedForecastSource[];
    warnings: string[];
    forecasts: Partial<Record<Source, CostLine>>;
  }>
> {
  try {
    const sources = allSources();
    const warnings: string[] = [];
    // Reasons keyed by source, emitted in registry order after the parallel
    // fetch so `sources_skipped` ordering is deterministic.
    const skipReasons: Partial<Record<Source, string>> = {};
    // gbpPerUsd() runs OUTSIDE the per-source catch — an FX-provider outage
    // here used to reject the whole handler and surface as a raw JSON-RPC
    // error. The outer try/catch makes it return the uniform { isError, error }
    // shape (masked) the spend handlers produce.
    const fxRate = args.currency === "GBP" ? await gbpPerUsd() : undefined;
    const forecasts: Partial<Record<Source, CostLine>> = {};

    await Promise.all(
      sources.map(async (source) => {
        if (!source.isAvailable()) {
          // GCP is not supported (never available), which is not a
          // credentials problem — surface the distinction so the user doesn't
          // try to add credentials that wouldn't help.
          skipReasons[source.name] =
            source.name === "gcp" ? "unsupported" : "skipped (no credentials)";
          return;
        }
        try {
          const line = await source.getForecastToMonthEnd();
          if (line === null) {
            skipReasons[source.name] =
              "no forecast available (source does not support forecasting, " +
              "or provider returned none)";
            return;
          }
          let entry: CostLine = line;
          if (fxRate !== undefined) {
            entry = {
              ...entry,
              amount_gbp: usdToGbp(entry.amount_usd, fxRate),
            };
          }
          if (!args.include_raw) {
            const stripped = { ...entry };
            delete stripped.raw;
            entry = stripped;
          }
          forecasts[source.name] = entry;
        } catch (err) {
          warnings.push(`${source.name}: ${formatError(err)}`);
          skipReasons[source.name] = "api error (see warnings)";
        }
      }),
    );

    const sourcesSkipped: SkippedForecastSource[] = sources
      .filter((source) => skipReasons[source.name] !== undefined)
      .map((source) => ({
        source: source.name,
        reason: skipReasons[source.name] as string,
      }));

    // sources_skipped and warnings serialize BEFORE the forecasts map so a
    // partial forecast is visibly partial up front.
    return {
      isError: false,
      result: { sources_skipped: sourcesSkipped, warnings, forecasts },
    };
  } catch (err) {
    return { isError: true, error: formatError(err) };
  }
}
