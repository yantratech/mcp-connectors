import { z } from "zod";
import { createControl } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const CreateControlTool = CreateDrataTool(
  "create_control",
  "Create a new control in a workspace (V2).",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    name: z.string().describe("Control name"),
    description: z.string().optional().describe("Control description"),
    question: z.string().optional().describe("Control question"),
    code: z.string().optional().describe("Control code identifier"),
    activity: z.string().optional().describe("Control activity description"),
  },
  async ({ workspaceId, ...fields }) => {
    const response = await createControl(workspaceId, fields);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default CreateControlTool;
