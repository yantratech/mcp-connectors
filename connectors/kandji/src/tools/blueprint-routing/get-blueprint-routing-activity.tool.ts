import { z } from "zod";
import { getBlueprintRoutingActivity } from "../../handlers/blueprint-routing.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetBlueprintRoutingActivityTool = CreateKandjiTool(
  "get_blueprint_routing_activity",
  "Get the change history for Blueprint Routing — who edited the routing rules and when. Audit evidence for enrollment-policy governance.",
  {
    max_results: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap on total activity entries returned"),
  },
  async ({ max_results }) => {
    const response = await getBlueprintRoutingActivity(max_results);
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

export default GetBlueprintRoutingActivityTool;
