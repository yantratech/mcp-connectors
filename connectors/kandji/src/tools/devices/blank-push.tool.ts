import { KandjiUuid } from "../../helpers/kandji-id.js";
import { triggerDeviceAction } from "../../handlers/device-actions.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const BlankPushTool = CreateKandjiTool(
  "blank_push",
  "Idempotent: sends a 'blank push' to wake the MDM channel — Apple Push Notification ping that nudges the device to check in with Kandji and run any queued commands. No user-visible effect. Sends POST /devices/{id}/action/blankpush. Use when a device appears stuck or commands have been queued for hours without response. Every successful call is logged to stderr.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
  },
  async ({ device_id }) => {
    const response = await triggerDeviceAction(device_id, "blankpush");
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

export default BlankPushTool;
