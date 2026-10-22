import { allSources } from "../sources/registry.js";
import { Anomaly } from "../types/cost-line.js";
import { YantraSpendClientResponse } from "../types/client-response.js";
import { formatError } from "../helpers/format-error.js";

export interface AnomaliesArgs {
  window_days: number;
  /**
   * When true, include the provider-original `raw` blob on every anomaly.
   * Default false — `raw` is omitted to match the spend_summary /
   * spend_by_source / top_movers / forecast_month_end convention.
   */
  include_raw?: boolean;
}

export async function anomalies(
  args: AnomaliesArgs,
): Promise<
  YantraSpendClientResponse<{ warnings: string[]; anomalies: Anomaly[] }>
> {
  try {
    const sources = allSources().filter((source) => source.isAvailable());
    const warnings: string[] = [];
    const collected: Anomaly[] = [];
    await Promise.all(
      sources.map(async (source) => {
        try {
          const result = await source.getAnomalies(args.window_days);
          collected.push(...result);
        } catch (err) {
          warnings.push(`${source.name}: ${formatError(err)}`);
        }
      }),
    );
    const processed = args.include_raw
      ? collected
      : collected.map((a) => {
          const copy = { ...a };
          delete copy.raw;
          return copy;
        });
    // warnings serialize before the anomalies array (signal-first convention).
    return {
      isError: false,
      result: { warnings, anomalies: processed },
    };
  } catch (err) {
    // Unexpected/escaping failure — return the uniform masked error shape the
    // spend handlers produce instead of letting it surface as a raw rejection.
    return { isError: true, error: formatError(err) };
  }
}
