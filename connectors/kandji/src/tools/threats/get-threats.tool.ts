import { z } from "zod";
import { KandjiFilterId } from "../../helpers/kandji-id.js";
import { getThreats } from "../../handlers/threats.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetThreatsTool = CreateKandjiTool(
  "get_threats",
  "List EDR threat detections (malware, PUPs, signature-based) across the fleet. License-gated — Kandji EDR must be enabled on the tenant, otherwise returns { count: 0, threats: [], license_gated: true }. Tries /api/v1/threat-details first and falls back to /api/v2/threat/threat-details on 404 (some tenants only expose one). Filter by device.",
  {
    device_id: KandjiFilterId.optional().describe("Filter to a single device"),
    max_results: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap on total threats returned"),
  },
  async ({ device_id, max_results }) => {
    const response = await getThreats({ deviceId: device_id }, max_results);
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

export default GetThreatsTool;
