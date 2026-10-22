import { z } from "zod";
import { KandjiUuid, KandjiFilterId } from "../../helpers/kandji-id.js";
import { updateCustomScript } from "../../handlers/library-write.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const UpdateCustomScriptTool = CreateKandjiTool(
  "update_custom_script",
  "Modify an existing Custom Script library item — its name, audit/remediation script content, frequency, or blueprint assignments. Sends PATCH /library/custom-scripts/{id} with only the supplied fields. Updated scripts run on the next check-in for assigned devices.",
  {
    library_item_id: KandjiUuid.describe("The Kandji library item ID"),
    name: z.string().optional(),
    script: z
      .string()
      .optional()
      .describe(
        "Replacement audit-script content (sent to the API as the `script` field).",
      ),
    remediation_script: z
      .string()
      .nullable()
      .optional()
      .describe("Remediation script content. Pass JSON null to remove it."),
    execution_frequency: z.string().optional(),
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
    const response = await updateCustomScript(library_item_id, payload);
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

export default UpdateCustomScriptTool;
