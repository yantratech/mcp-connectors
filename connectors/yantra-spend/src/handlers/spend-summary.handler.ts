import { gbpPerUsd, roundCurrency, usdToGbp } from "../fx/fx.js";
import { allSources } from "../sources/registry.js";
import { SourceModule } from "../sources/source-module.js";
import {
  CostLine,
  Currency,
  Source,
  SourceTotal,
  SpendSummary,
} from "../types/cost-line.js";
import { YantraSpendClientResponse } from "../types/client-response.js";
import { formatError } from "../helpers/format-error.js";

export interface SpendSummaryArgs {
  start: Date;
  end: Date;
  currency: Currency;
  /**
   * Reserved for forward compatibility. spend_summary doesn't return `raw`
   * fields today (the response is per-source totals only); the parameter is
   * accepted to keep the spend_summary / spend_by_source surfaces aligned.
   */
  include_raw?: boolean;
}

interface SourceRunResult {
  /** Successful runs hold the line array. Failed runs hold null. */
  lines: CostLine[] | null;
  /** Reason the run was skipped, errored, or unavailable. */
  skipReason?: string;
}

export async function spendSummary(
  args: SpendSummaryArgs,
): Promise<YantraSpendClientResponse<SpendSummary>> {
  try {
    const { start, end, currency } = args;
    const span = end.getTime() - start.getTime();
    if (span <= 0) {
      return {
        isError: true,
        error: "spend_summary: end must be strictly greater than start",
      };
    }
    const priorStart = new Date(start.getTime() - span);
    const priorEnd = new Date(start.getTime());

    const fxRate = currency === "GBP" ? await gbpPerUsd() : undefined;
    const sources = allSources();
    const warnings: string[] = [];

    // Current + prior are independent reads — run them concurrently to halve
    // wall-clock latency (each source's fetch is already source-parallel
    // within runSources, but current/prior were sequential before this).
    const [current, prior] = await Promise.all([
      runSources(sources, start, end, warnings, "current"),
      runSources(sources, priorStart, priorEnd, warnings, "prior"),
    ]);

    const totals: SourceTotal[] = [];
    let grand = 0;
    let anyCurrentFailureOrSkip = false;
    for (const source of sources) {
      const run = current[source.name];
      if (run.lines === null) {
        // Failed or skipped — surface in `sources` with null amounts so the
        // caller can distinguish "asked, errored" from "didn't ask".
        totals.push({
          source: source.name,
          amount_usd: null,
          amount_gbp: fxRate !== undefined ? null : undefined,
          line_count: null,
        });
        anyCurrentFailureOrSkip = true;
      } else {
        const sum = run.lines.reduce((acc, line) => acc + line.amount_usd, 0);
        const usdRounded = roundCurrency(sum);
        totals.push({
          source: source.name,
          amount_usd: usdRounded,
          amount_gbp:
            fxRate !== undefined ? usdToGbp(usdRounded, fxRate) : undefined,
          line_count: run.lines.length,
        });
        // Accumulate already-rounded per-source totals so grand_total_usd ==
        // sum-of-per-source-amount_usd to the cent.
        grand += usdRounded;
      }
    }

    const partial = anyCurrentFailureOrSkip;
    const grandRounded = roundCurrency(grand);

    // wow_delta_pct intersection rule:
    //   Compute over the intersection of sources that returned non-null
    //   amount_usd in BOTH current and prior windows. partial=true still
    //   signals that not all sources contributed, but it does not null wow:
    //   otherwise the always-unavailable GCP source, or any source without
    //   credentials, would null wow on every call and make the delta
    //   useless.
    //
    // Null only when:
    //   - the intersection is empty (no source had data in both windows)
    //   - the prior intersection sum is ≤ 0 (divide-by-zero)
    //   - the current intersection sum is 0 (no spend to compare)
    const intersection: Source[] = [];
    let currentIntersectionSum = 0;
    let priorIntersectionSum = 0;
    for (const source of sources) {
      const curLines = current[source.name].lines;
      const priLines = prior[source.name].lines;
      if (curLines !== null && priLines !== null) {
        intersection.push(source.name);
        currentIntersectionSum += curLines.reduce(
          (acc, line) => acc + line.amount_usd,
          0,
        );
        priorIntersectionSum += priLines.reduce(
          (acc, line) => acc + line.amount_usd,
          0,
        );
      }
    }

    let wowDelta: number | null = null;
    let wowReason: string | null = null;
    if (intersection.length === 0) {
      wowReason = "no source returned data in both windows";
    } else if (roundCurrency(currentIntersectionSum) === 0) {
      wowReason = "intersection grand_total_usd is zero";
    } else if (priorIntersectionSum <= 0) {
      wowReason = "prior intersection sum is zero";
    } else {
      wowDelta = roundCurrency(
        ((currentIntersectionSum - priorIntersectionSum) /
          priorIntersectionSum) *
          100,
      );
    }
    if (wowDelta === null && wowReason !== null) {
      warnings.push(`wow_delta_pct: null because ${wowReason}`);
    } else if (wowDelta !== null && partial) {
      // Tell the caller which sources actually contributed so a non-null
      // wow alongside partial=true is interpretable.
      warnings.push(
        `wow_delta_pct computed over: ${intersection.join(", ")}`,
      );
    }

    // partial/warnings serialize BEFORE the sources array so skip/error
    // signals survive a clipped read.
    return {
      isError: false,
      result: {
        period_start: start.toISOString(),
        period_end: end.toISOString(),
        currency,
        fx_gbp_per_usd: fxRate,
        grand_total_usd: grandRounded,
        grand_total_gbp:
          fxRate !== undefined ? usdToGbp(grandRounded, fxRate) : undefined,
        wow_delta_pct: wowDelta,
        partial,
        warnings,
        sources: totals,
      },
    };
  } catch (err) {
    return { isError: true, error: formatError(err) };
  }
}

async function runSources(
  sources: ReadonlyArray<SourceModule>,
  start: Date,
  end: Date,
  warnings: string[],
  bucket: "current" | "prior",
): Promise<Record<string, SourceRunResult>> {
  const out: Record<string, SourceRunResult> = {};
  await Promise.all(
    sources.map(async (source) => {
      if (!source.isAvailable()) {
        // GCP is not supported (never available), which is not a credentials
        // problem — surface the distinction so the user doesn't try to add
        // credentials that wouldn't help.
        const reason =
          source.name === "gcp" ? "unsupported" : "skipped (no credentials)";
        out[source.name] = { lines: null, skipReason: reason };
        // Only emit the warning once (current window) — prior window adds
        // noise without information.
        if (bucket === "current") {
          warnings.push(`${source.name}: ${reason}`);
        }
        return;
      }
      try {
        const lines = await source.getCostLines(start, end);
        out[source.name] = { lines };
      } catch (err) {
        const msg = formatError(err);
        warnings.push(`${source.name} [${bucket}]: ${msg}`);
        out[source.name] = { lines: null, skipReason: `api error: ${msg}` };
      }
    }),
  );
  return out;
}
