import { KandjiUuid } from "../../helpers/kandji-id.js";
import { deleteCustomScript } from "../../handlers/library-write.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const DeleteCustomScriptTool = CreateKandjiTool(
  "delete_custom_script",
  "DESTRUCTIVE: permanently deletes a Custom Script library item and removes it from any blueprints currently using it. Already-run side effects on devices are NOT undone. Irreversible. Sends DELETE /library/custom-scripts/{id}. Use get_custom_script first to confirm scope. Every successful call is logged to stderr.",
  {
    library_item_id: KandjiUuid.describe("The Kandji library item ID"),
  },
  async ({ library_item_id }) => {
    const response = await deleteCustomScript(library_item_id);
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

export default DeleteCustomScriptTool;
