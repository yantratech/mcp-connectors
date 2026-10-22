import { z } from "zod";
import { listBlueprints } from "../../handlers/list-blueprints.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const ListBlueprintsTool = CreateKandjiTool(
  "list_blueprints",
  "List all blueprints (policy bundles) configured in Kandji. A blueprint is the unit of configuration applied to a device and bundles profiles, apps, and scripts.",
  {
    max_results: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap on total blueprints returned"),
  },
  async ({ max_results }) => {
    const response = await listBlueprints(max_results);
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

export default ListBlueprintsTool;
