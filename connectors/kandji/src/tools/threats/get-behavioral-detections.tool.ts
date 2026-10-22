import { z } from "zod";
import { KandjiFilterId } from "../../helpers/kandji-id.js";
import { getBehavioralDetections } from "../../handlers/threats.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetBehavioralDetectionsTool = CreateKandjiTool(
  "get_behavioral_detections",
  "List EDR behavioral detection events (anomalous process/file/network behavior) across the fleet. License-gated — Kandji EDR must be enabled on the tenant, otherwise returns { count: 0, events: [], license_gated: true }. Tries /api/v1/behavioral-detections first and falls back to /api/v2/threat/behavioral-detections/events on 404.",
  {
    device_id: KandjiFilterId.optional().describe("Filter to a single device"),
    max_results: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap on total events returned"),
  },
  async ({ device_id, max_results }) => {
    const response = await getBehavioralDetections(
      { deviceId: device_id },
      max_results,
    );
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

export default GetBehavioralDetectionsTool;
