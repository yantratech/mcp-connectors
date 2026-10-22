import { KandjiUuid } from "../../helpers/kandji-id.js";
import { deleteCustomApp } from "../../handlers/library-write.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const DeleteCustomAppTool = CreateKandjiTool(
  "delete_custom_app",
  "DESTRUCTIVE: permanently deletes a Custom App library item and removes it from any blueprints currently using it. Already-installed copies on devices are not uninstalled by this call. Irreversible. Sends DELETE /library/custom-apps/{id}. Use get_custom_app and get_library_item_status first to confirm scope. Every successful call is logged to stderr.",
  {
    library_item_id: KandjiUuid.describe("The Kandji library item ID"),
  },
  async ({ library_item_id }) => {
    const response = await deleteCustomApp(library_item_id);
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

export default DeleteCustomAppTool;
