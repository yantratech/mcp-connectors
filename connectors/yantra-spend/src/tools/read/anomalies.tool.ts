import { z } from "zod";
import { anomalies } from "../../handlers/anomalies.handler.js";
import { CreateYantraSpendTool } from "../../helpers/create-yantra-spend-tool.js";

const AnomaliesTool = CreateYantraSpendTool(
  "anomalies",
  "Provider-detected anomalies in the trailing window. Only AWS Cost Anomaly Detection returns results; other sources return an empty list. Returns { anomalies, warnings }. Anomaly schema: source, detected_at (ISO-8601 UTC), description, impact_usd (where reported by the provider). The provider-original `raw` blob is omitted by default; pass include_raw=true to attach it (AWS raw carries the full Anomalies record with AnomalyStartDate/EndDate, RootCauses[], and Impact).",
  {
    window_days: z
      .number()
      .int()
      .positive()
      .max(90)
      .default(7)
      .describe("Trailing window length in days. Default 7."),
    include_raw: z
      .boolean()
      .default(false)
      .describe(
        "When true, include the provider-original `raw` blob on every anomaly. Default false.",
      ),
  },
  async ({ window_days, include_raw }) => {
    const response = await anomalies({ window_days, include_raw });
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

export default AnomaliesTool;
