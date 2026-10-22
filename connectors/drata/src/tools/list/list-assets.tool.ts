import { z } from "zod";
import { listAssets } from "../../handlers/list-entities.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ListAssetsTool = CreateDrataTool(
  "list_assets",
  "List assets in the Drata asset inventory. Removed (offboarded) assets are excluded by default so `total` matches the app's live inventory; set includeRemoved to page through them (rows carry removedAt). Returns a single page; iterate with `page` to fetch more.",
  {
    size: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe("Per-page size (1–500, default 20)."),
    page: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("1-based page number (default 1)."),
    includeRemoved: z
      .boolean()
      .optional()
      .describe(
        "Include removed (offboarded) assets — rows with removedAt set. Default false.",
      ),
  },
  async ({ size, page, includeRemoved }) => {
    const response = await listAssets({ size, page, includeRemoved });
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListAssetsTool;
