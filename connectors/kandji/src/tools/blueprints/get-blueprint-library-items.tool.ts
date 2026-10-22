import { z } from "zod";
import { KandjiUuid } from "../../helpers/kandji-id.js";
import { getBlueprintLibraryItems } from "../../handlers/get-blueprint-library-items.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetBlueprintLibraryItemsTool = CreateKandjiTool(
  "get_blueprint_library_items",
  "List every library item (profile, app, script) assigned to a given blueprint. Use this to audit what policy a blueprint actually applies.",
  {
    blueprint_id: KandjiUuid.describe("The Kandji blueprint ID"),
    max_results: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap on total items returned across pagination"),
  },
  async ({ blueprint_id, max_results }) => {
    const response = await getBlueprintLibraryItems(blueprint_id, max_results);
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

export default GetBlueprintLibraryItemsTool;
