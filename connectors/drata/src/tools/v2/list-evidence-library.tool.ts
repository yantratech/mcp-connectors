import { z } from "zod";
import { listEvidenceLibrary } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";
import type { DrataQueryParams } from "../../clients/drata-client.js";

const ListEvidenceLibraryTool = CreateDrataTool(
  "list_evidence_library",
  "List items in the evidence library for a workspace. Returns ONE page (default size 50) with the real workspace total; page with `cursor`, or pass `fetchAll: true` (ideally with fields[]) to merge every page.",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    cursor: z.string().optional().describe("Cursor from a previous response."),
    size: z.number().int().min(1).max(500).optional().describe("Page size."),
    sort: z.string().optional().describe("Sort field supported by Drata."),
    sortDir: z.enum(["ASC", "DESC"]).optional().describe("Sort direction."),
    includeTotalCount: z
      .boolean()
      .optional()
      .describe("Include total count on the first page."),
    expand: z.array(z.string()).optional().describe("Expansion fields."),
    name: z.string().optional().describe("Filter evidence by name."),
    statuses: z.array(z.string()).optional().describe("Filter by evidence statuses."),
    fields: z
      .array(z.string())
      .optional()
      .describe('Return only selected fields, e.g. ["id", "name", "status"].'),
    fetchAll: z
      .boolean()
      .optional()
      .describe(
        "Merge every page into one response. Large libraries produce very large output — combine with fields[].",
      ),
  },
  async ({
    workspaceId,
    cursor,
    size,
    sort,
    sortDir,
    includeTotalCount,
    expand,
    name,
    statuses,
    fields,
    fetchAll,
  }) => {
    const params: DrataQueryParams = {
      cursor,
      size,
      sort,
      sortDir,
      includeTotalCount,
      expand,
      name,
      statuses,
    };
    const response = await listEvidenceLibrary(workspaceId, params, {
      fields,
      fetchAll,
    });
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListEvidenceLibraryTool;
