import { z } from "zod";
import { listCustomProfiles } from "../../handlers/library.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const ListCustomProfilesTool = CreateKandjiTool(
  "list_custom_profiles",
  "List Custom Configuration Profiles (.mobileconfig) defined in the library. Use this to audit what profiles the tenant is shipping to devices. Returns profile metadata (name, active, mdm_identifier, runs_on_* platforms, timestamps); the embedded mobileconfig XML is omitted by default — pass detail: true to include it, or use get_custom_profile for one item.",
  {
    max_results: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap on total profiles returned"),
    detail: z
      .boolean()
      .optional()
      .describe(
        "If true, include each profile's full mobileconfig XML (`profile` field, ~4k chars per item).",
      ),
  },
  async ({ max_results, detail }) => {
    const response = await listCustomProfiles(max_results, detail);
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

export default ListCustomProfilesTool;
