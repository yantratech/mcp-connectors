import { KandjiUuid } from "../../helpers/kandji-id.js";
import { getDeviceLostMode } from "../../handlers/get-device-lost-mode.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetDeviceLostModeTool = CreateKandjiTool(
  "get_device_lost_mode",
  "Get the Lost Mode state for a device — enabled/disabled, last known location, custom message, and phone number shown on lock screen.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
  },
  async ({ device_id }) => {
    const response = await getDeviceLostMode(device_id);
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
  { readOnlyHint: true, idempotentHint: true },
);

export default GetDeviceLostModeTool;
