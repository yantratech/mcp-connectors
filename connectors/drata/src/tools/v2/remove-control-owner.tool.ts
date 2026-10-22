import { z } from "zod";
import { removeControlOwner } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const RemoveControlOwnerTool = CreateDrataTool(
  "remove_control_owner",
  "Remove an owner from a control (V2).",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    controlId: z.number().describe("ID of the control"),
    ownerId: z.number().describe("Owner ID to remove"),
  },
  async ({ workspaceId, controlId, ownerId }) => {
    const response = await removeControlOwner(workspaceId, controlId, ownerId);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default RemoveControlOwnerTool;
