import { z } from "zod";
import { listInHouseApps } from "../../handlers/library.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const ListInHouseAppsTool = CreateKandjiTool(
  "list_in_house_apps",
  "List In-House (enterprise-signed .ipa) apps for iOS/iPadOS defined in the library.",
  {
    max_results: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap on total in-house apps returned"),
  },
  async ({ max_results }) => {
    const response = await listInHouseApps(max_results);
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

export default ListInHouseAppsTool;
