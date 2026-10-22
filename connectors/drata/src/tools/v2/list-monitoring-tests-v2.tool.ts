import { z } from "zod";
import { listMonitoringTestsV2 } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";
import type { DrataQueryParams } from "../../clients/drata-client.js";

const ListMonitoringTestsV2Tool = CreateDrataTool(
  "list_monitoring_tests_v2",
  "List monitoring tests for a workspace. Returns ONE page (default size 50) with the real workspace total; page with `cursor`, or pass `fetchAll: true` to merge every page.",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    cursor: z.string().optional().describe("Cursor from a previous response."),
    size: z.number().int().min(1).max(500).optional().describe("Page size."),
    includeTotalCount: z
      .boolean()
      .optional()
      .describe("Include total count on the first page (defaults on)."),
    fetchAll: z
      .boolean()
      .optional()
      .describe(
        "Merge every page into one response (~500 chars per test — large fleets produce very large output).",
      ),
  },
  async ({ workspaceId, cursor, size, includeTotalCount, fetchAll }) => {
    const params: DrataQueryParams = { cursor, size, includeTotalCount };
    const response = await listMonitoringTestsV2(workspaceId, params, {
      fetchAll,
    });
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListMonitoringTestsV2Tool;
