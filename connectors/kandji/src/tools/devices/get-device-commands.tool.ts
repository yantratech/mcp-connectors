import { KandjiUuid } from "../../helpers/kandji-id.js";
import { getDeviceCommands } from "../../handlers/get-device-commands.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetDeviceCommandsTool = CreateKandjiTool(
  "get_device_commands",
  "Get the MDM command history for a device (lock, erase, install, restart, etc.) including status, request time, and result. Use for incident-response reconstruction and audit evidence.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
  },
  async ({ device_id }) => {
    const response = await getDeviceCommands(device_id);
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

export default GetDeviceCommandsTool;
