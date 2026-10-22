import { z } from "zod";
import { listFrameworkRequirements } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";
import type { DrataQueryParams } from "../../clients/drata-client.js";

const ListFrameworkRequirementsTool = CreateDrataTool(
  "list_framework_requirements",
  "List framework requirements for a workspace. Returns a single page with the real workspace total; iterate with `cursor` to fetch more. The bulky additionalInfo* guidance prose is omitted by default — request it via fields.",
  {
    workspaceId: z
      .number()
      .optional()
      .describe(
        "Workspace ID. Auto-resolves to the first workspace from /public/v2/workspaces if neither this nor DRATA_WORKSPACE_ID is set.",
      ),
    frameworkId: z
      .number()
      .optional()
      .describe(
        "Framework ID — validated against the workspace's frameworks (errors listing available ids) and applied CLIENT-side, because the upstream endpoint silently ignores this query param.",
      ),
    size: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe("Per-page size (1–500, default 20)."),
    cursor: z
      .string()
      .optional()
      .describe("Cursor from a previous response's `pagination.cursor`."),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Return only selected fields, e.g. ["id", "name", "description"]. Pass ["*"] for full records including the multi-KB additionalInfo* prose (omitted by default).',
      ),
  },
  async ({ workspaceId, frameworkId, size, cursor, fields }) => {
    const params: DrataQueryParams = { frameworkId, size, cursor };
    const response = await listFrameworkRequirements(workspaceId, params, {
      fields,
    });
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListFrameworkRequirementsTool;
