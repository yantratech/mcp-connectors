import { KandjiUuid } from "../../helpers/kandji-id.js";
import { getInHouseApp } from "../../handlers/library.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetInHouseAppTool = CreateKandjiTool(
  "get_in_house_app",
  "Get a single In-House App library item by ID — bundle identifier, version, signing info, assignment.",
  {
    library_item_id: KandjiUuid.describe("The Kandji library item ID"),
  },
  async ({ library_item_id }) => {
    const response = await getInHouseApp(library_item_id);
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

export default GetInHouseAppTool;
