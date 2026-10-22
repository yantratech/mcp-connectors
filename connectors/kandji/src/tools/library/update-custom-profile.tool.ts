import { z } from "zod";
import { KandjiUuid } from "../../helpers/kandji-id.js";
import { updateCustomProfile } from "../../handlers/library-write.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const UpdateCustomProfileTool = CreateKandjiTool(
  "update_custom_profile",
  "Modify an existing Custom Profile library item — its name, device-family targeting, or .mobileconfig payload. Sends PATCH /library/custom-profiles/{id}. When `mobileconfig` is provided the request is multipart/form-data with the new XML in the `file` part (which triggers re-installation on assigned devices at next check-in); when only metadata is provided the request is JSON. Use assign_library_item / remove_library_item to manage blueprint assignments.",
  {
    library_item_id: KandjiUuid.describe("The Kandji library item ID"),
    name: z.string().optional().describe("New display name"),
    mobileconfig: z
      .string()
      .optional()
      .describe(
        "Replacement .mobileconfig XML content — when provided, the request becomes a multipart/form-data PATCH with the XML in the `file` part.",
      ),
    runs_on_mac: z.boolean().optional().describe("Target macOS devices."),
    runs_on_iphone: z.boolean().optional().describe("Target iPhone devices."),
    runs_on_ipad: z.boolean().optional().describe("Target iPad devices."),
    runs_on_tv: z.boolean().optional().describe("Target Apple TV devices."),
    runs_on_vision: z
      .boolean()
      .optional()
      .describe("Target Apple Vision Pro devices."),
  },
  async ({ library_item_id, ...rest }) => {
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) payload[key] = value;
    }
    if (Object.keys(payload).length === 0) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Error: at least one field must be provided to update",
          },
        ],
      };
    }
    const response = await updateCustomProfile(library_item_id, payload);
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
  { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
);

export default UpdateCustomProfileTool;
