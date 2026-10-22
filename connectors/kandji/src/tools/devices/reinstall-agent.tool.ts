import { KandjiUuid } from "../../helpers/kandji-id.js";
import { triggerDeviceAction } from "../../handlers/device-actions.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const ReinstallAgentTool = CreateKandjiTool(
  "reinstall_agent",
  "Queue a reinstall of the Kandji macOS agent on the device. Use when the agent is reporting stale data, has stopped checking in, or has been manually removed by the user. Sends POST /devices/{id}/action/reinstallagent. Briefly disrupts in-flight library-item enforcement; not destructive to user data. Every successful call is logged to stderr.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID (macOS only)"),
  },
  async ({ device_id }) => {
    const response = await triggerDeviceAction(device_id, "reinstallagent");
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

export default ReinstallAgentTool;
