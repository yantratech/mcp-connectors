import { z } from "zod";
import { createControlNote } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const CreateControlNoteTool = CreateDrataTool(
  "create_control_note",
  "Create a note on a control (V2). Uses 'comment' field (max 768 chars).",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    controlId: z.number().describe("ID of the control"),
    comment: z
      .string()
      .max(768)
      .describe("Note comment text (max 768 characters)"),
  },
  async ({ workspaceId, controlId, comment }) => {
    const response = await createControlNote(workspaceId, controlId, comment);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default CreateControlNoteTool;
