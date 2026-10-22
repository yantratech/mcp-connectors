import { z } from "zod";
import { listVendors } from "../../handlers/list-entities.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ListVendorsTool = CreateDrataTool(
  "list_vendors",
  "List vendors in the Drata vendor inventory. Compact rows by default (id, name, category, risk, critical, impactLevel, isArchived) with leading active/archived counts; full vendor prose fields are opt-in via fields[] or get_vendor. Returns a single page; iterate with `page`.",
  {
    size: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe("Per-page size (1–500, default 50)."),
    page: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("1-based page number (default 1)."),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Return only these raw vendor fields per row instead of the compact projection, e.g. ["id", "name", "dataStored", "securityReview"]. Lower `size` when opting into prose-heavy fields.',
      ),
  },
  async ({ size, page, fields }) => {
    const response = await listVendors({ size, page, fields });
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListVendorsTool;
