import { z } from "zod";
import { getFxRate } from "../../handlers/get-fx-rate.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetFxRateTool = CreateXeroTool(
  "get_fx_rate",
  "Get a historical foreign exchange rate for a given currency pair and date. \
  Uses ECB reference rates via frankfurter.app; if that fails, falls back to the community-maintained \
  fawazahmed0/currency-api on cdn.jsdelivr.net, which is not ECB data. The result names its source. \
  Supports all major currencies including GBP, USD, EUR, and 30+ others. \
  For the ECB source, rates are published once per business day (~16:00 CET), \
  and weekend/holiday dates return the previous business day's rate. \
  Useful for MTM revaluations, FX gain/loss calculations, and manual journal postings.",
  {
    from: z
      .string()
      .describe(
        "The source currency code (e.g. 'GBP', 'USD', 'EUR'). Case-insensitive.",
      ),
    to: z
      .string()
      .describe(
        "The target currency code (e.g. 'USD', 'EUR', 'GBP'). Case-insensitive. Can also be comma-separated for multiple targets (e.g. 'USD,EUR').",
      ),
    date: z
      .string()
      .describe(
        "The date for the historical rate in YYYY-MM-DD format (e.g. '2025-06-15'). Use 'latest' for the most recent available rate.",
      ),
  },
  async ({ from, to, date }) => {
    // Support multiple target currencies (e.g. "USD,EUR")
    const targets = to
      .split(",")
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);

    if (targets.length === 1) {
      const result = await getFxRate({ from, to: targets[0], date });

      if (result.isError) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error fetching FX rate: ${result.error}`,
            },
          ],
        };
      }

      const r = result.result!;
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `FX Rate (${r.source}):`,
              `1 ${r.from} = ${r.rate} ${r.to}`,
              `Date: ${r.date}`,
            ].join("\n"),
          },
        ],
      };
    }

    // Multiple targets
    const results: string[] = [];
    const errors: string[] = [];

    for (const target of targets) {
      const result = await getFxRate({ from, to: target, date });
      if (result.isError) {
        errors.push(`${target}: ${result.error}`);
      } else {
        const r = result.result!;
        results.push(`1 ${r.from} = ${r.rate} ${r.to} (${r.source})`);
      }
    }

    const lines = [`FX Rates for ${date}:`, ...results];
    if (errors.length > 0) {
      lines.push("", "Errors:", ...errors);
    }

    return {
      content: [
        {
          type: "text" as const,
          text: lines.join("\n"),
        },
      ],
    };
  },
);

export default GetFxRateTool;
