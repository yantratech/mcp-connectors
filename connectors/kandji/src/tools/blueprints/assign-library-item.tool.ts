import { KandjiUuid } from "../../helpers/kandji-id.js";
import { assignLibraryItemToBlueprint } from "../../handlers/blueprint-write.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const AssignLibraryItemTool = CreateKandjiTool(
  "assign_library_item",
  "Add a library item (custom app, custom profile, custom script, IPA app, etc.) to a blueprint, taking effect on the next device check-in. Sends POST /blueprints/{id}/assign_library_item with the supplied library item ID. Use list_blueprints + list_custom_apps (or list_custom_profiles/list_custom_scripts/list_in_house_apps) to find the IDs first.",
  {
    blueprint_id: KandjiUuid.describe("The Kandji blueprint ID"),
    library_item_id: KandjiUuid.describe("The Kandji library item ID to add to the blueprint"),
  },
  async ({ blueprint_id, library_item_id }) => {
    const response = await assignLibraryItemToBlueprint(
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

export default AssignLibraryItemTool;
