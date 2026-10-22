import { z } from "zod";
import { modifyControlOwners } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ModifyControlOwnersTool = CreateDrataTool(
  "modify_control_owners",
  "Replace all owners of a control with the specified user IDs (V2). \
DESTRUCTIVE — existing owners NOT in the new list are removed. To add an owner without \
removing others, use add_control_owner. To remove just one owner, use remove_control_owner.",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    controlId: z.number().describe("ID of the control"),
    userIds: z.array(z.number()).describe("Array of user IDs to set as owners"),
  },
  async ({ workspaceId, controlId, userIds }) => {
    const response = await modifyControlOwners(workspaceId, controlId, userIds);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
  // PUT-replace on the owners collection: anyone not in userIds is removed.
  { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
);

export default ModifyControlOwnersTool;
