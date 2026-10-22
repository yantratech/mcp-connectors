import { z } from "zod";
import { modifyControl } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ModifyControlTool = CreateDrataTool(
  "modify_control",
  "Update an existing control in a workspace (V2).",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    controlId: z.number().describe("ID of the control to modify"),
    name: z.string().optional().describe("Updated control name"),
    description: z.string().optional().describe("Updated description"),
    question: z.string().optional().describe("Updated question"),
    code: z.string().optional().describe("Updated control code"),
    activity: z.string().optional().describe("Updated activity description"),
  },
  async ({ workspaceId, controlId, ...fields }) => {
    const response = await modifyControl(workspaceId, controlId, fields);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ModifyControlTool;
