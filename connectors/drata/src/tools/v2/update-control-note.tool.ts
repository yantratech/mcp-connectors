import { z } from "zod";
import { updateControlNote } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const UpdateControlNoteTool = CreateDrataTool(
  "update_control_note",
  "Update an existing note on a control (V2). Note IDs are UUID strings.",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    controlId: z.number().describe("ID of the control"),
    noteId: z.string().describe("UUID of the note to update"),
    comment: z
      .string()
      .max(768)
      .describe("Updated note comment text (max 768 characters)"),
  },
  async ({ workspaceId, controlId, noteId, comment }) => {
    const response = await updateControlNote(workspaceId, controlId, noteId, comment);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default UpdateControlNoteTool;
