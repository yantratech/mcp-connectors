import { z } from "zod";
import { KandjiUuid } from "../../helpers/kandji-id.js";
import { getDeviceApps } from "../../handlers/get-device-apps.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetDeviceAppsTool = CreateKandjiTool(
  "get_device_apps",
  "Get the applications installed on a specific device. Returns { count, returned, apps } where count is the device's full app total; rows default to key fields (app name, version, bundle ID, source, install path) — pass detail: true for full records, and max_results to cap large inventories. Note: preinstalled Apple apps on iPhone/iPad are not reported by the API.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID to look up apps for"),
    max_results: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Cap on apps returned. When it truncates, the response flags truncated: true and count still carries the device's full app total.",
      ),
    detail: z
      .boolean()
      .optional()
      .describe(
        "If true, returns full app records (bundle_size, signature, install dates, VPP flags, ...) instead of the default key-field projection.",
      ),
  },
  async ({ device_id, max_results, detail }) => {
    const response = await getDeviceApps(device_id, {
      maxResults: max_results,
      detail,
    });

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

export default GetDeviceAppsTool;
