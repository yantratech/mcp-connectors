import { z } from "zod";
import { listCustomApps } from "../../handlers/library.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const ListCustomAppsTool = CreateKandjiTool(
  "list_custom_apps",
  "List Custom Apps (macOS .pkg/.zip/.dmg installers uploaded to Kandji) defined in the library.",
  {
    max_results: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap on total custom apps returned"),
  },
  async ({ max_results }) => {
    const response = await listCustomApps(max_results);
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

export default ListCustomAppsTool;
