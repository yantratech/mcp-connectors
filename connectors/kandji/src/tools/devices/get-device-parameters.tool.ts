import { KandjiUuid } from "../../helpers/kandji-id.js";
import { getDeviceParameters } from "../../handlers/get-device-parameters.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetDeviceParametersTool = CreateKandjiTool(
  "get_device_parameters",
  "Get the Kandji-managed parameter configuration state for a device (hardening parameters such as screen lock, firewall, Gatekeeper, and their per-device status).",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
  },
  async ({ device_id }) => {
    const response = await getDeviceParameters(device_id);
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

export default GetDeviceParametersTool;
