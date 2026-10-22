import { KandjiUuid } from "../../helpers/kandji-id.js";
import { getDevice } from "../../handlers/get-device.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetDeviceTool = CreateKandjiTool(
  "get_device",
  "Get the summary record for a single device (hostname, serial, blueprint, user, last_check_in — the Kandji AGENT's check-in clock; the MDM clock lives in get_device_details under mdm.last_check_in). Lighter than get_device_details — use this when you just need the row-level info that appears in list_devices. Also the loud existence check: 404s on unknown device IDs, unlike get_device_activity/list_device_notes which 200-empty.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
  },
  async ({ device_id }) => {
    const response = await getDevice(device_id);
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
);

export default GetDeviceTool;
