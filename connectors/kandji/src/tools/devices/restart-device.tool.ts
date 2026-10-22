import { KandjiUuid } from "../../helpers/kandji-id.js";
import { triggerDeviceAction } from "../../handlers/device-actions.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const RestartDeviceTool = CreateKandjiTool(
  "restart_device",
  "DISRUPTIVE: queues an MDM 'RestartDevice' command that immediately reboots the device, dropping any unsaved work and active sessions. Sends POST /devices/{id}/action/restart. Use to recover a misbehaving device or to apply a pending OS update during a maintenance window. Every successful call is logged to stderr.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
  },
  async ({ device_id }) => {
    const response = await triggerDeviceAction(device_id, "restart");
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

export default RestartDeviceTool;
