import { z } from "zod";
import { KandjiUuid } from "../../helpers/kandji-id.js";
import { getDeviceActivity } from "../../handlers/get-device-activity.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetDeviceActivityTool = CreateKandjiTool(
  "get_device_activity",
  "Get the activity log for a specific device — timeline of MDM commands, check-ins, profile installs, and status changes. Returns { returned, total_available, truncated, note?, activity } — defaults to the first 50 entries in API order, with total_available carrying the device's full entry count; raise max_results to fetch more. Caveat: the API 200-empties for nonexistent device IDs (an empty result does not prove the device exists — get_device 404s loudly).",
  {
    device_id: KandjiUuid.describe("The Kandji device ID to get activity for"),
    max_results: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap on total activity entries returned. Defaults to 50."),
  },
  async ({ device_id, max_results }) => {
    const response = await getDeviceActivity(device_id, max_results);

    if (response.isError) {
      return renderToolError(response);
    }

    // Compact serialization — activity entries average ~770 JSON chars each.
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(response.result) },
      ],
    };
  },
);

export default GetDeviceActivityTool;
