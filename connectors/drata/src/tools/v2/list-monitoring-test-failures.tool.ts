import { z } from "zod";
import { listMonitoringTestFailures } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ListMonitoringTestFailuresTool = CreateDrataTool(
  "list_monitoring_test_failures",
  "List failures for a specific monitoring test with V2 cursor pagination. Identify the test with EITHER `testId` (the workspace-scoped testId from list_monitoring_tests_v2) OR `monitorId` (the monitor id from list_monitors / check_monitors / the monitoring-test `id` field) — the two integer namespaces overlap, so pass `monitorId` when your id came from a monitor listing. The id is resolved against the workspace test list before fetching, and the response echoes the resolved testId/monitorId/testName so the result is never silently attributed to the wrong test.",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    testId: z
      .number()
      .optional()
      .describe(
        "Workspace-scoped testId from list_monitoring_tests_v2 (the small `testId` field). Provide exactly one of testId or monitorId.",
      ),
    monitorId: z
      .number()
      .optional()
      .describe(
        "Monitor id from list_monitors / check_monitors (the monitoring-test `id` field). Provide exactly one of testId or monitorId.",
      ),
  },
  async ({ workspaceId, testId, monitorId }) => {
    const response = await listMonitoringTestFailures(workspaceId, testId, monitorId);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListMonitoringTestFailuresTool;
