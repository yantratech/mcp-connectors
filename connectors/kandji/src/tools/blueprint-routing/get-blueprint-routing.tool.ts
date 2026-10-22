import { getBlueprintRouting } from "../../handlers/blueprint-routing.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetBlueprintRoutingTool = CreateKandjiTool(
  "get_blueprint_routing",
  "Get the tenant-wide Blueprint Routing configuration — rules that decide which blueprint a newly-enrolled device lands on based on serial, model, user, or ADE token.",
  {},
  async () => {
    const response = await getBlueprintRouting();
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
  { readOnlyHint: true, idempotentHint: true },
);

export default GetBlueprintRoutingTool;
