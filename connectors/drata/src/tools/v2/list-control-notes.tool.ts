import { z } from "zod";
import { listControlNotes } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ListControlNotesTool = CreateDrataTool(
  "list_control_notes",
  "List all notes on a control with cursor pagination (V2).",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    controlId: z.number().describe("ID of the control"),
  },
  async ({ workspaceId, controlId }) => {
    const response = await listControlNotes(workspaceId, controlId);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListControlNotesTool;
