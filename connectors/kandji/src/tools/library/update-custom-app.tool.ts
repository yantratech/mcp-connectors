import { z } from "zod";
import { KandjiUuid, KandjiFilterId } from "../../helpers/kandji-id.js";
import { updateCustomApp } from "../../handlers/library-write.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const UpdateCustomAppTool = CreateKandjiTool(
  "update_custom_app",
  "Modify an existing Custom App library item — its metadata, scripts, enforcement mode, or Self Service exposure. Sends PATCH /library/custom-apps/{id} with only the supplied fields. To replace the underlying installer binary, use upload_custom_app_binary to get a new file_key and pass it here.",
  {
    library_item_id: KandjiUuid.describe("The Kandji library item ID"),
    name: z.string().optional().describe("New display name"),
    file_key: z
      .string()
      .optional()
      .describe("New S3 file_key from upload_custom_app_binary"),
    install_type: z.string().optional(),
    install_enforcement: z.string().optional(),
    audit_script: z
      .string()
      .nullable()
      .optional()
      .describe("Audit script content. Pass JSON null to remove it."),
    preinstall_script: z
      .string()
      .nullable()
      .optional()
      .describe("Pre-install script content. Pass JSON null to remove it."),
    postinstall_script: z
      .string()
      .nullable()
      .optional()
      .describe("Post-install script content. Pass JSON null to remove it."),
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
    const response = await updateCustomApp(library_item_id, payload);
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

export default UpdateCustomAppTool;
