import { z } from "zod";
import { listCustomScripts } from "../../handlers/library.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const ListCustomScriptsTool = CreateKandjiTool(
  "list_custom_scripts",
  "List Custom Scripts defined in the library. Critical for auditing what code Kandji runs on managed endpoints.",
  {
    max_results: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap on total scripts returned"),
  },
  async ({ max_results }) => {
    const response = await listCustomScripts(max_results);
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

export default ListCustomScriptsTool;
