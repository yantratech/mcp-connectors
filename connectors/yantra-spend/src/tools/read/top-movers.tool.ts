import { z } from "zod";
import { topMovers } from "../../handlers/top-movers.handler.js";
import { CreateYantraSpendTool } from "../../helpers/create-yantra-spend-tool.js";
import { parseIsoUtc } from "../../helpers/parse-iso-utc.js";

const TopMoversTool = CreateYantraSpendTool(
  "top_movers",
  "Cross-source top week-over-week increases. For each available source, queries [start, end) with that source's natural grouping axis (aws=service, azure=service, anthropic=description, openai=line_item, cursor=user; GCP is not supported), compares against the equal-length prior window, and returns the largest positive deltas across the union. Sources without credentials are skipped silently.",
  {
    start: z.string().describe("ISO-8601 inclusive start (UTC assumed)."),
    end: z.string().describe("ISO-8601 exclusive end (UTC assumed)."),
    limit: z
      .number()
      .int()
      .positive()
      .max(100)
      .default(5)
      .describe("Maximum number of movers to return."),
    currency: z
      .enum(["USD", "GBP"])
      .default("USD")
      .describe("Output currency."),
  },
  async ({ start, end, limit, currency }) => {
    const startDt = parseIsoUtc(start).date;
    const endDt = parseIsoUtc(end).date;
    const response = await topMovers({
      start: startDt,
      end: endDt,
      limit,
      currency,
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

export default TopMoversTool;
