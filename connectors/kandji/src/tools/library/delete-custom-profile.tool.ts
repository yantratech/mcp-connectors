import { KandjiUuid } from "../../helpers/kandji-id.js";
import { deleteCustomProfile } from "../../handlers/library-write.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const DeleteCustomProfileTool = CreateKandjiTool(
  "delete_custom_profile",
  "DESTRUCTIVE: permanently deletes a Custom Profile library item and removes it from any blueprints currently using it. Already-installed profiles on devices are removed by Kandji at next check-in. Irreversible. Sends DELETE /library/custom-profiles/{id}. Use get_custom_profile and get_library_item_status first to confirm scope. Every successful call is logged to stderr.",
  {
    library_item_id: KandjiUuid.describe("The Kandji library item ID"),
  },
  async ({ library_item_id }) => {
    const response = await deleteCustomProfile(library_item_id);
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

export default DeleteCustomProfileTool;
