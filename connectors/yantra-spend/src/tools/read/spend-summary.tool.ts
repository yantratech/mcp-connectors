import { z } from "zod";
import { spendSummary } from "../../handlers/spend-summary.handler.js";
import { CreateYantraSpendTool } from "../../helpers/create-yantra-spend-tool.js";
import { parseIsoUtc } from "../../helpers/parse-iso-utc.js";

const SpendSummaryTool = CreateYantraSpendTool(
  "spend_summary",
  "Aggregated spend across every available source for [start, end). Returns per-source totals, a grand total, the week-over-week delta on the grand total (computed against the equal-length prior window), a `partial: bool` flag (true when any source was skipped or errored), and warnings. Sources that fail their underlying API call are surfaced in `sources` with amount_usd=null and line_count=null and excluded from grand_total. line_count counts PROVIDER-RETURNED rows only — no zero-padding — so it can be lower than spend_by_source's total_line_count for the same window (which includes zero-pad day lines; provider rows there = total_line_count - zero_pad_line_count). That difference is expected, not a data discrepancy. wow_delta_pct is computed over the sources that returned data in BOTH the current and prior windows (the intersection); it is non-null even when partial=true. It is null only when that intersection is empty, when the prior intersection sum is <= 0, or when the current intersection sum rounds to zero — the reason is appended to `warnings`, and the contributing sources are listed in `warnings` when partial. USD is canonical; pass currency=GBP to also populate amount_gbp on every total. The optional `include_raw` flag is reserved for forward compatibility — spend_summary returns per-source totals only and does not surface provider `raw` blobs.",
  {
    start: z
      .string()
      .describe(
        "ISO-8601 datetime or date (UTC assumed when bare). Inclusive period start.",
      ),
    end: z
      .string()
      .describe(
        "ISO-8601 datetime or date (UTC assumed when bare). Exclusive period end. Must be strictly greater than start.",
      ),
    currency: z
      .enum(["USD", "GBP"])
      .default("USD")
      .describe(
        "Output currency. USD is canonical; GBP is converted via cached FX (60s TTL).",
      ),
    include_raw: z
      .boolean()
      .default(false)
      .describe(
        "Reserved for forward compatibility — spend_summary does not return `raw` fields today.",
      ),
  },
  async ({ start, end, currency, include_raw }) => {
    const startDt = parseIsoUtc(start).date;
    const endDt = parseIsoUtc(end).date;
    const response = await spendSummary({
      start: startDt,
      end: endDt,
      currency,
      include_raw,
    });
    if (response.isError) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${response.error}` }],
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(response.result, null, 2),
        },
      ],
    };
  },
);

export default SpendSummaryTool;
