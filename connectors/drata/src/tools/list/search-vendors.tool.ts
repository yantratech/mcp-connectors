import { z } from "zod";
import { searchVendors } from "../../handlers/vendor-read.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const SearchVendorsTool = CreateDrataTool(
  "search_vendors",
  "Search vendors by name (case-insensitive substring match). Returns matching vendors with key fields. Matches include archived vendors, marked with archived/archivedAt — check the flag before treating a match as an operational vendor (the upstream status field is null for most active vendors and is not returned).",
  {
    query: z
      .string()
      .min(1)
      .describe(
        "Non-empty search string to match against vendor names (case-insensitive substring). Use list_vendors to enumerate all.",
      ),
  },
  async ({ query }) => {
    const response = await searchVendors(query);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default SearchVendorsTool;
