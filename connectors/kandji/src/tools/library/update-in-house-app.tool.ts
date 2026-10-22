import { z } from "zod";
import { KandjiUuid, KandjiFilterId } from "../../helpers/kandji-id.js";
import { updateInHouseApp } from "../../handlers/library-write.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const UpdateInHouseAppTool = CreateKandjiTool(
  "update_in_house_app",
  "Modify an existing In-House (IPA) App library item — its metadata, enforcement mode, Self Service exposure, or assigned blueprints. Sends PATCH /library/ipa-apps/{id} with only the supplied fields. To replace the underlying .ipa binary, use upload_in_house_app_binary to get a new file_key and pass it here.",
  {
    library_item_id: KandjiUuid.describe("The Kandji library item ID"),
    name: z.string().optional().describe("New display name"),
    file_key: z
      .string()
      .optional()
      .describe("New S3 file_key from upload_in_house_app_binary"),
    install_enforcement: z.string().optional(),
    show_in_self_service: z.boolean().optional(),
    self_service_category_id: KandjiFilterId.nullable().optional()
      .describe("Self Service category. Pass JSON null to clear it."),
    blueprints: z
      .array(z.string())
      .optional()
      .describe("New full set of blueprint IDs (replaces the existing list)"),
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
    const response = await updateInHouseApp(library_item_id, payload);
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

export default UpdateInHouseAppTool;
