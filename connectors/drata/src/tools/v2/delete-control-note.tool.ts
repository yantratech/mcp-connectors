import { z } from "zod";
import { deleteControlNote } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const DeleteControlNoteTool = CreateDrataTool(
  "delete_control_note",
  "Delete a note from a control (V2). Note IDs are UUID strings.",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    controlId: z.number().describe("ID of the control"),
    noteId: z.string().describe("UUID of the note to delete"),
  },
  async ({ workspaceId, controlId, noteId }) => {
    const response = await deleteControlNote(workspaceId, controlId, noteId);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default DeleteControlNoteTool;
