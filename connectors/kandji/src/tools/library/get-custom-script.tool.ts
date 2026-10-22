import { KandjiUuid } from "../../helpers/kandji-id.js";
import { getCustomScript } from "../../handlers/library.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetCustomScriptTool = CreateKandjiTool(
  "get_custom_script",
  "Get a single Custom Script library item — includes the script body, execution frequency, and remediation script.",
  {
    library_item_id: KandjiUuid.describe("The Kandji library item ID"),
  },
  async ({ library_item_id }) => {
    const response = await getCustomScript(library_item_id);
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

export default GetCustomScriptTool;
