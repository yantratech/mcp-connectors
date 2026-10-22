import { KandjiUuid } from "../../helpers/kandji-id.js";
import { triggerDeviceAction } from "../../handlers/device-actions.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const LockDeviceTool = CreateKandjiTool(
  "lock_device",
  "DESTRUCTIVE: queues an MDM 'DeviceLock' command that immediately locks the screen, requires the device PIN to unlock, and on macOS may also set a six-digit PIN that must then be entered at the EFI screen. Use only for confirmed loss/theft or compliance enforcement — the user loses access until unlocked. Sends POST /devices/{id}/action/lock and returns the queued command record. Every successful call is logged to stderr.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID to lock"),
  },
  async ({ device_id }) => {
    const response = await triggerDeviceAction(device_id, "lock");
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

export default LockDeviceTool;
