import { KandjiUuid } from "../../helpers/kandji-id.js";
import { triggerDeviceAction } from "../../handlers/device-actions.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const DisableLostModeTool = CreateKandjiTool(
  "disable_lost_mode",
  "Queue an MDM 'DisableLostMode' command (supervised iOS/iPadOS only) that takes a device out of Lost Mode and restores normal user access. Sends POST /devices/{id}/action/disablelostmode. Use after a recovered device returns to its assigned user. Every successful call is logged to stderr.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
  },
  async ({ device_id }) => {
    const response = await triggerDeviceAction(device_id, "disablelostmode");
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

export default DisableLostModeTool;
