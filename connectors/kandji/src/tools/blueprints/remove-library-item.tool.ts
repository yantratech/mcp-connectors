import { KandjiUuid } from "../../helpers/kandji-id.js";
import { removeLibraryItemFromBlueprint } from "../../handlers/blueprint-write.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const RemoveLibraryItemTool = CreateKandjiTool(
  "remove_library_item",
  "Remove a library item from a blueprint, taking effect on the next device check-in (devices stop receiving the item but already-installed payloads are NOT proactively uninstalled by this call alone). Sends POST /blueprints/{id}/remove_library_item with the supplied library item ID. Use get_blueprint_library_items to confirm membership first.",
  {
    blueprint_id: KandjiUuid.describe("The Kandji blueprint ID"),
    library_item_id: KandjiUuid.describe("The Kandji library item ID to remove from the blueprint"),
  },
  async ({ blueprint_id, library_item_id }) => {
    const response = await removeLibraryItemFromBlueprint(
      blueprint_id,
      library_item_id,
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
  { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
);

export default RemoveLibraryItemTool;
