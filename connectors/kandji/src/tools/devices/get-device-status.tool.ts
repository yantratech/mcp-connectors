import { KandjiUuid } from "../../helpers/kandji-id.js";
import { getDeviceStatus } from "../../handlers/get-device-status.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetDeviceStatusTool = CreateKandjiTool(
  "get_device_status",
  "Get the compliance status of a specific device. Returns per-library-item pass/fail status showing which configuration profiles, apps, and scripts are compliant or failing on the device. Caveat: the upstream status vocabulary is mixed — compliant items appear as both 'success' (lowercase) and 'PASS' (uppercase) in the same response, so compare case-insensitively and treat the two as equivalent.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID to check status for"),
  },
  async ({ device_id }) => {
    const response = await getDeviceStatus(device_id);

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

export default GetDeviceStatusTool;
