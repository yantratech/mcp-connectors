import { KandjiUuid } from "../../helpers/kandji-id.js";
import { getBlueprint } from "../../handlers/get-blueprint.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetBlueprintTool = CreateKandjiTool(
  "get_blueprint",
  "Get a single blueprint by ID — its name, description, enrollment code, default assignment, and metadata.",
  {
    blueprint_id: KandjiUuid.describe("The Kandji blueprint ID"),
  },
  async ({ blueprint_id }) => {
    const response = await getBlueprint(blueprint_id);
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

export default GetBlueprintTool;
