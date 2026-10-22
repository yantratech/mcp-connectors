import { KandjiUuid } from "../../helpers/kandji-id.js";
import { getDeviceDetails } from "../../handlers/get-device-details.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetDeviceDetailsTool = CreateKandjiTool(
  "get_device_details",
  "Get comprehensive details for a specific device by ID. Returns hardware info, OS version, serial number, security settings (FileVault, Firewall, SIP), MDM status, blueprint assignment, assigned user, network info, and storage details. Note: this response carries TWO distinct check-in clocks — kandji_agent.last_check_in (the agent clock, same one list_devices reports as last_check_in, ISO format) and mdm.last_check_in (the MDM protocol clock, space-separated timestamp format); they can differ by minutes, so pick the clock that matches the liveness claim you're making.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID to look up"),
  },
  async ({ device_id }) => {
    const response = await getDeviceDetails(device_id);

    if (response.isError) {
      return renderToolError(response);
    }

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(response.result, null, 2) },
      ],
    };
  },
);

export default GetDeviceDetailsTool;
