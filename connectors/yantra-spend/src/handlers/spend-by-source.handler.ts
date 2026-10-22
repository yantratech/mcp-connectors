import { gbpPerUsd, usdToGbp } from "../fx/fx.js";
import { findSource } from "../sources/registry.js";
import { CostLine, Currency, Source } from "../types/cost-line.js";
import { YantraSpendClientResponse } from "../types/client-response.js";
import { formatError } from "../helpers/format-error.js";
import { validateGroupBy } from "../helpers/group-by-allowlist.js";

export interface SpendBySourceArgs {
  source: Source;
  start: Date;
  end: Date;
  group_by?: string;
  currency: Currency;
  /**
   * When true, include the provider-original `raw` blob on every CostLine.
   * Default false — `raw` is omitted to keep responses small.
   */
  include_raw?: boolean;
  /**
   * Maximum number of CostLines to return. High-cardinality group_by axes
   * (usage_type, resource, api_key_id) over long windows can fan out to
   * thousands of lines and overflow the MCP token cap. When the source
   * produces more lines than this, the highest-spend lines are kept (then
   * re-sorted by period_start) and `truncated`/`total_line_count` flag the
   * elision. Defaults to DEFAULT_LINE_LIMIT.
   */
  limit?: number;
}

/**
 * Default cap on returned lines. Sized so the default response stays under
 * ~30k serialized chars (~200 chars/line): holds a single ungrouped quarter
 * (≈90 padded days) without truncating, while grouped windows over
 * high-cardinality axes truncate with a warning instead of emitting very
 * large responses (high-cardinality axes over 90 days can produce thousands
 * of lines).
 */
export const DEFAULT_LINE_LIMIT = 150;

/** Sources that get day-padding (zero-amount lines for missing days). */
const PAD_SOURCES: ReadonlySet<Source> = new Set([
  "aws",
  "anthropic",
  "openai",
  "cursor",
]);

const DAY_MS = 24 * 60 * 60 * 1000;

export async function spendBySource(
  args: SpendBySourceArgs,
): Promise<
  YantraSpendClientResponse<{
    /**
     * Total lines before any limit was applied — INCLUDES zero-pad day
     * lines. Provider-returned rows = total_line_count −
     * zero_pad_line_count (that difference is what spend_summary reports
     * as line_count for the same window).
     */
    total_line_count: number;
    /** Lines actually present in `lines` (== lines.length). */
    returned_line_count: number;
    /** Zero-amount day-padding lines added (pre-truncation count). */
    zero_pad_line_count: number;
    /** True when the source produced more lines than `limit` and some were elided. */
    truncated: boolean;
    warnings: string[];
    lines: CostLine[];
  }>
> {
  try {
    const source = findSource(args.source);
    if (!source) {
      return { isError: true, error: `unknown source: ${args.source}` };
    }
    // Validate group_by against the per-source allowlist. Unknown values
    // throw at the handler boundary rather than silently coercing.
    validateGroupBy(args.source, args.group_by);

    const warnings: string[] = [];
    if (!source.isAvailable()) {
      // GCP is not supported (never available), which is not a credentials
      // problem — surface the distinction so the user doesn't try to add
      // credentials that wouldn't help.
      const reason =
        args.source === "gcp" ? "unsupported" : "skipped (no credentials)";
      warnings.push(`${args.source}: ${reason}`);
      return {
        isError: false,
        result: {
          total_line_count: 0,
          returned_line_count: 0,
          zero_pad_line_count: 0,
          truncated: false,
          warnings,
          lines: [],
        },
      };
    }
    const fxRate = args.currency === "GBP" ? await gbpPerUsd() : undefined;
    const rawLines = await source.getCostLines(
      args.start,
      args.end,
      args.group_by,
    );

    let processed = rawLines;
    // Day padding — pad missing days for the listed sources so day arrays
    // align across sources at the call-site.
    if (PAD_SOURCES.has(args.source)) {
      processed = padMissingDays(
        processed,
        args.start,
        args.end,
        args.source,
        args.group_by,
      );
    }
    const zeroPadLineCount = processed.length - rawLines.length;

    // FX conversion.
    if (fxRate !== undefined) {
      processed = processed.map((line) => ({
        ...line,
        amount_gbp: usdToGbp(line.amount_usd, fxRate),
      }));
    }

    // Strip `raw` unless explicitly requested.
    if (!args.include_raw) {
      processed = processed.map((line) => {
        const copy = { ...line };
        delete copy.raw;
        return copy;
      });
    }

    // Cap returned lines so a high-cardinality / long-window call can't
    // overflow the MCP token budget. Keep the highest-spend lines (most
    // useful), then restore period_start ordering for the kept subset so the
    // day-aligned contract holds on the returned slice.
    const totalLineCount = processed.length;
    const limit =
      args.limit !== undefined && args.limit > 0
        ? args.limit
        : DEFAULT_LINE_LIMIT;
    let truncated = false;
    if (totalLineCount > limit) {
      truncated = true;
      processed = [...processed]
        .sort((a, b) => b.amount_usd - a.amount_usd)
        .slice(0, limit)
        .sort((a, b) => a.period_start.localeCompare(b.period_start));
      warnings.push(
        `truncated: returned the top ${limit} lines by amount_usd of ` +
          `${totalLineCount} total — narrow the window, drop or coarsen ` +
          `group_by, or pass a larger 'limit' (max 5000) to see the rest`,
      );
    }

    // Truncation/warning signals serialize BEFORE the lines array so a
    // consumer whose context clips the payload still sees them.
    return {
      isError: false,
      result: {
        total_line_count: totalLineCount,
        returned_line_count: processed.length,
        zero_pad_line_count: zeroPadLineCount,
        truncated,
        warnings,
        lines: processed,
      },
    };
  } catch (err) {
    return { isError: true, error: formatError(err) };
  }
}

/**
 * Pad zero-amount lines for days inside [start, end) the source returned no
 * data for. Day boundary is UTC midnight.
 *
 * For ungrouped queries: one zero-line per missing day.
 * For grouped queries: one zero-line per missing day with `group_by_field`
 * set (so the field carries through) and `group_by_value` explicitly `null`
 * — undefined would be DROPPED by JSON.stringify, leaving lines that just
 * lack the key and read as "group value missing" rather than "padded day".
 * null marks the line as a pad ("no data for any group that day"), which a
 * caller must not misread as "some group spent $0 that day".
 *
 * The source-name parameter ensures we can emit pad lines even when the
 * source returned zero rows for the entire window.
 */
function padMissingDays(
  lines: CostLine[],
  start: Date,
  end: Date,
  source: Source,
  groupBy?: string,
): CostLine[] {
  // Anchor padding to UTC-midnight floors of [start, end). Non-midnight
  // bounds are treated as the day they fall within — pad lines emit only for
  // full UTC days whose midnight is in [startMid, endMid).
  const startMid = new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate(),
    ),
  );
  const endMid = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
  );

  const present = new Set<string>();
  for (const line of lines) {
    const ps = new Date(line.period_start);
    if (Number.isNaN(ps.getTime())) continue;
    const dayIso = new Date(
      Date.UTC(ps.getUTCFullYear(), ps.getUTCMonth(), ps.getUTCDate()),
    ).toISOString();
    present.add(dayIso);
  }

  const padded: CostLine[] = [...lines];
  for (let t = startMid.getTime(); t < endMid.getTime(); t += DAY_MS) {
    const dayIso = new Date(t).toISOString();
    const nextDay = new Date(t + DAY_MS).toISOString();
    if (!present.has(dayIso)) {
      padded.push({
        source,
        period_start: dayIso,
        period_end: nextDay,
        amount_usd: 0,
        group_by_field: groupBy,
        // Explicit null (survives JSON serialization) on grouped queries;
        // ungrouped pads carry neither key, matching real ungrouped lines.
        group_by_value: groupBy === undefined ? undefined : null,
      });
    }
  }
  padded.sort((a, b) => a.period_start.localeCompare(b.period_start));
  return padded;
}
