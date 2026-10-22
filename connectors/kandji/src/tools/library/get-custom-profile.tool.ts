import { KandjiUuid } from "../../helpers/kandji-id.js";
import { getCustomProfile } from "../../handlers/library.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetCustomProfileTool = CreateKandjiTool(
  "get_custom_profile",
  "Get a single Custom Configuration Profile library item — payloads, targeted platforms, assignment.",
  {
    library_item_id: KandjiUuid.describe("The Kandji library item ID"),
  },
  async ({ library_item_id }) => {
    const response = await getCustomProfile(library_item_id);
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

export default GetCustomProfileTool;
