import { z } from "zod";
import {
  DEFAULT_LINE_LIMIT,
  spendBySource,
} from "../../handlers/spend-by-source.handler.js";
import { CreateYantraSpendTool } from "../../helpers/create-yantra-spend-tool.js";
import { parseIsoUtc } from "../../helpers/parse-iso-utc.js";
import { SOURCES } from "../../types/cost-line.js";

const SpendBySourceTool = CreateYantraSpendTool(
  "spend_by_source",
  "Cost lines for a single source between [start, end), optionally grouped. group_by axis is source-specific and validated against an allowlist (unknown values throw): aws=service|region|account|usage_type|tag:project|tag:env|tag:owner; azure=service|resource_group|resource|meter|subscription; anthropic=workspace_id|description; openai=project_id|line_item|api_key_id; cursor=user|model|kind. GCP is not supported (always unavailable). Days inside [start, end) for which aws/anthropic/openai/cursor returned no data are padded with zero-amount lines so day arrays align across sources; in grouped responses a pad line has group_by_value: null (explicit), meaning 'no data for ANY group that day' — not 'a group spent $0'. Cursor windows over 30 days are auto-chunked server-side (no user-facing 30-day error). The provider-original `raw` blob is omitted by default; pass include_raw=true to attach it to every CostLine. Returns { total_line_count, returned_line_count, zero_pad_line_count, truncated, warnings, lines } — signals serialize before the array. total_line_count INCLUDES zero-pad lines; provider-returned rows = total_line_count - zero_pad_line_count, which is what spend_summary's line_count reports for the same window (the two are not a discrepancy). High-cardinality axes (usage_type, resource, api_key_id) over long windows can produce thousands of lines; the response is capped at `limit` (default 150) keeping the highest-spend lines — when truncated=true the returned lines are NOT the full universe: total_line_count gives the full count and a warning says how to see the rest (narrow the window, drop/coarsen group_by, or raise limit). warnings also includes a 'skipped (no credentials)' note when the source has no env vars.",
  {
    source: z
      .enum(SOURCES)
      .describe(
        "Source name. GCP is not supported and returns an empty list with a warning.",
      ),
    start: z.string().describe("ISO-8601 inclusive start (UTC assumed)."),
    end: z.string().describe("ISO-8601 exclusive end (UTC assumed)."),
    group_by: z
      .string()
      .optional()
      .describe(
        "Source-specific grouping axis (see tool description). Validated against the per-source allowlist; unknown values throw. Omit for ungrouped daily totals.",
      ),
    currency: z
      .enum(["USD", "GBP"])
      .default("USD")
      .describe("Output currency."),
    include_raw: z
      .boolean()
      .default(false)
      .describe(
        "When true, include the provider-original `raw` blob on every CostLine. Default false. Roughly triples response size — combine with a small `limit`.",
      ),
    limit: z
      .number()
      .int()
      .positive()
      .max(5000)
      .default(DEFAULT_LINE_LIMIT)
      .describe(
        `Maximum number of cost lines to return. The highest-spend lines are kept when the source produces more; truncated=true and total_line_count then report the elision. Default ${DEFAULT_LINE_LIMIT}; large values can exceed the MCP token budget.`,
      ),
  },
  async ({ source, start, end, group_by, currency, include_raw, limit }) => {
    const startDt = parseIsoUtc(start).date;
    const endDt = parseIsoUtc(end).date;
    const response = await spendBySource({
      source,
      start: startDt,
      end: endDt,
      group_by,
      currency,
      include_raw,
      limit,
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
          // Compact (no indent): this is the connector's one bulk-line
          // response and 2-space pretty-printing adds ~30% on multi-hundred
          // line payloads.
          text: JSON.stringify(response.result),
        },
      ],
    };
  },
);

export default SpendBySourceTool;
