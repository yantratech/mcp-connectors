import { z } from "zod";
import { deleteEvidenceLibraryItem } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const DeleteEvidenceLibraryItemTool = CreateDrataTool(
  "delete_evidence_library_item",
  "Delete an evidence library item from a workspace (V2).",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    itemId: z.number().describe("ID of the evidence library item to delete"),
  },
  async ({ workspaceId, itemId }) => {
    const response = await deleteEvidenceLibraryItem(workspaceId, itemId);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default DeleteEvidenceLibraryItemTool;
