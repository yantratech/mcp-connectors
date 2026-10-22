import { z } from "zod";
import { healthCheck } from "../../handlers/health.handler.js";
import { CreateYantraSpendTool } from "../../helpers/create-yantra-spend-tool.js";

const HealthTool = CreateYantraSpendTool(
  "health",
  "Per-source availability check. With probe=false (default) returns a flat { aws, gcp, azure, anthropic, openai, cursor } → boolean map flagging only env-var presence. With probe=true, makes a cheap call to each source's API (yesterday's window for AWS/Azure/Anthropic/OpenAI cost endpoints; for Cursor, a one-event POST to the filtered-usage-events endpoint its cost queries use, over the last 24h) and returns { aws, gcp, … } → { available: bool, reachable: bool, error?: string, missing_env?: string[] }, distinguishing 'no credentials' from 'creds present but API unreachable'. When a source is unavailable, missing_env lists the env var(s) to set to enable it. Required env vars per source: aws=AWS_ACCESS_KEY_ID+AWS_SECRET_ACCESS_KEY; azure=AZURE_TENANT_ID+AZURE_CLIENT_ID+AZURE_CLIENT_SECRET+AZURE_SUBSCRIPTION_IDS; anthropic=ANTHROPIC_ADMIN_KEY; openai=OPENAI_ADMIN_KEY; cursor=CURSOR_ADMIN_API_KEY; GCP is not supported (always unavailable; no credentials enable it). Probing costs one round trip per available source.",
  {
    probe: z
      .boolean()
      .default(false)
      .describe(
        "When true, hit each source's API with a cheap call to verify reachability. Default false (env-var presence only).",
      ),
  },
  async ({ probe }) => {
    const response = await healthCheck({ probe });
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

export default HealthTool;
