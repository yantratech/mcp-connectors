import { z } from "zod";
import { listFrameworks } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ListFrameworksTool = CreateDrataTool(
  "list_frameworks",
  "List all compliance frameworks for a workspace (V2).",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
  },
  async ({ workspaceId }) => {
    const response = await listFrameworks(workspaceId);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListFrameworksTool;
