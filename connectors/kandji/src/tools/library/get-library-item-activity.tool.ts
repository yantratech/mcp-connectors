import { z } from "zod";
import { KandjiUuid } from "../../helpers/kandji-id.js";
import { getLibraryItemActivity } from "../../handlers/library.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetLibraryItemActivityTool = CreateKandjiTool(
  "get_library_item_activity",
  "Get the edit/assignment activity history for a library item — who changed what and when. Audit evidence for library governance. Caveat: the API 200-empties for nonexistent library item IDs — an empty history does not prove the item exists (the response flags this; verify IDs via the list_* library tools).",
  {
    library_item_id: KandjiUuid.describe("The Kandji library item ID"),
    max_results: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap on total activity rows returned across pagination"),
  },
  async ({ library_item_id, max_results }) => {
    const response = await getLibraryItemActivity(library_item_id, max_results);
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

export default GetLibraryItemActivityTool;
