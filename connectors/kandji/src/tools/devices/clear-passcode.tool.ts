import { KandjiUuid } from "../../helpers/kandji-id.js";
import { triggerDeviceAction } from "../../handlers/device-actions.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const ClearPasscodeTool = CreateKandjiTool(
  "clear_passcode",
  "DESTRUCTIVE (data-loss adjacent): queues an MDM 'ClearPasscode' command that wipes the device passcode. On iOS/iPadOS this disables Activation Lock requirements briefly and on macOS it can invalidate FileVault unlock for non-admin users. Sends POST /devices/{id}/action/clearpasscode. Use only when the user is locked out and you have authority to remove the passcode. Every successful call is logged to stderr.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
  },
  async ({ device_id }) => {
    const response = await triggerDeviceAction(device_id, "clearpasscode");
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
  { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
);

export default ClearPasscodeTool;
