import { z } from "zod";
import { getMonitoringTest } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const GetMonitoringTestTool = CreateDrataTool(
  "get_monitoring_test",
  "Get details of a specific monitoring test (V2). Identify the test with EITHER `testId` (the workspace-scoped testId from list_monitoring_tests_v2) OR `monitorId` (the monitor id from list_monitors / check_monitors) — the two integer namespaces overlap, so pass `monitorId` when your id came from a monitor listing.",
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
    const response = await getMonitoringTest(workspaceId, testId, monitorId);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default GetMonitoringTestTool;
