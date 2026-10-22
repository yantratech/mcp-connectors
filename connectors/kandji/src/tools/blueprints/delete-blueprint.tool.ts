import { KandjiUuid } from "../../helpers/kandji-id.js";
import { deleteBlueprint } from "../../handlers/blueprint-write.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const DeleteBlueprintTool = CreateKandjiTool(
  "delete_blueprint",
  "DESTRUCTIVE: permanently deletes a blueprint and unassigns it from any devices currently using it. Devices reassigned to a fallback or unassigned blueprint as Kandji enforces. Irreversible. Sends DELETE /blueprints/{id}. Verify the blueprint has no critical assignments via get_blueprint_library_items first. Every successful call is logged to stderr.",
  {
    blueprint_id: KandjiUuid.describe("The Kandji blueprint ID"),
  },
  async ({ blueprint_id }) => {
    const response = await deleteBlueprint(blueprint_id);
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

export default DeleteBlueprintTool;
