import { z } from "zod";
import { KandjiUuid } from "../../helpers/kandji-id.js";
import { updateBlueprint } from "../../handlers/blueprint-write.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const UpdateBlueprintTool = CreateKandjiTool(
  "update_blueprint",
  "Modify an existing blueprint's name or description. Sends PATCH /blueprints/{id} with only the supplied fields. Returns the updated blueprint record. Library-item membership is changed via assign_library_item / remove_library_item, not here.",
  {
    blueprint_id: KandjiUuid.describe("The Kandji blueprint ID"),
    name: z.string().min(1).optional().describe("New blueprint name"),
    description: z
      .string()
      .nullable()
      .optional()
      .describe(
        "New description. Pass JSON null (or an empty string) to clear it.",
      ),
  },
  async ({ blueprint_id, name, description }) => {
    const payload: Record<string, unknown> = {};
    if (name !== undefined) payload.name = name;
    if (description !== undefined) payload.description = description;
    if (Object.keys(payload).length === 0) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Error: at least one field (name or description) must be provided",
          },
        ],
      };
    }
    const response = await updateBlueprint(blueprint_id, payload);
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

export default UpdateBlueprintTool;
