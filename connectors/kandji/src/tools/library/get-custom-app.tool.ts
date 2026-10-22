import { KandjiUuid } from "../../helpers/kandji-id.js";
import { getCustomApp } from "../../handlers/library.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetCustomAppTool = CreateKandjiTool(
  "get_custom_app",
  "Get a single Custom App library item by ID — metadata, install script, audit script, and assignment.",
  {
    library_item_id: KandjiUuid.describe("The Kandji library item ID"),
  },
  async ({ library_item_id }) => {
    const response = await getCustomApp(library_item_id);
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

export default GetCustomAppTool;
