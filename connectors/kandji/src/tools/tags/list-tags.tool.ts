import { z } from "zod";
import { listTags } from "../../handlers/list-tags.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const ListTagsTool = CreateKandjiTool(
  "list_tags",
  "List all tags defined in the tenant. Tags are freeform labels applied to devices and used as filter criteria in blueprint routing and library-item assignment.",
  {
    max_results: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap on total tags returned"),
  },
  async ({ max_results }) => {
    const response = await listTags(max_results);
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

export default ListTagsTool;
