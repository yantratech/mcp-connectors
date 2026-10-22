import { KandjiUuid } from "../../helpers/kandji-id.js";
import { getDeviceLibraryItems } from "../../handlers/get-device-library-items.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetDeviceLibraryItemsTool = CreateKandjiTool(
  "get_device_library_items",
  "List the library items (profiles, apps, scripts) assigned to a device via its blueprint, with the current install status per item. Use this for per-device compliance posture auditing.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
  },
  async ({ device_id }) => {
    const response = await getDeviceLibraryItems(device_id);
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

export default GetDeviceLibraryItemsTool;
