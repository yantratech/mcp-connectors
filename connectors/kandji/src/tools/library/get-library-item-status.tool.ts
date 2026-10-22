import { z } from "zod";
import { KandjiUuid } from "../../helpers/kandji-id.js";
import { getLibraryItemStatus } from "../../handlers/library.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetLibraryItemStatusTool = CreateKandjiTool(
  "get_library_item_status",
  "Get per-device install/run status for a library item across every device it's assigned to. Use to identify which devices are failing a specific profile, app, or script. Caveat: the API 200-empties for nonexistent library item IDs — a zero-device result does not prove the item exists (the response flags this; verify IDs via the list_* library tools).",
  {
    library_item_id: KandjiUuid.describe("The Kandji library item ID"),
    max_results: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap on total status rows returned across pagination"),
  },
  async ({ library_item_id, max_results }) => {
    const response = await getLibraryItemStatus(library_item_id, max_results);
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
);

export default GetLibraryItemStatusTool;
