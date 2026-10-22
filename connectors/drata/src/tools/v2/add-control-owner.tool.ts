import { z } from "zod";
import { addControlOwner } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const AddControlOwnerTool = CreateDrataTool(
  "add_control_owner",
  "Add an owner to a control (V2).",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    controlId: z.number().describe("ID of the control"),
    userId: z.number().describe("User ID to add as owner"),
  },
  async ({ workspaceId, controlId, userId }) => {
    const response = await addControlOwner(workspaceId, controlId, userId);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default AddControlOwnerTool;
