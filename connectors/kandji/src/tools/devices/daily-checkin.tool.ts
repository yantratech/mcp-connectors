import { KandjiUuid } from "../../helpers/kandji-id.js";
import { triggerDailyCheckin } from "../../handlers/device-refresh-actions.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const DailyCheckinTool = CreateKandjiTool(
  "daily_checkin",
  "Queue a non-destructive daily check-in for a device — re-runs audit scripts and refreshes library-item status. No user-visible effect. Every successful call is logged to stderr.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
  },
  async ({ device_id }) => {
    const response = await triggerDailyCheckin(device_id);
    if (response.isError) {
      return renderToolError(response);
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
  { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
);

export default DailyCheckinTool;
