import { listSelfServiceCategories } from "../../handlers/library.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const ListSelfServiceCategoriesTool = CreateKandjiTool(
  "list_self_service_categories",
  "List the Self Service categories configured for end-user app browsing.",
  {},
  async () => {
    const response = await listSelfServiceCategories();
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

export default ListSelfServiceCategoriesTool;
