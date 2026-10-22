import { z } from "zod";
import { updateRiskNote } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const UpdateRiskNoteTool = CreateDrataTool(
  "update_risk_note",
  "Update an existing note on a risk (V2). Note IDs are UUID strings. The updated text goes in the `comment` field. Works on the base tier once a riskRegisterId is known — pass riskRegisterId or set DRATA_RISK_REGISTER_ID; only the register enumerator (list_risk_registers) is Pro-gated.",
  {
    riskRegisterId: z
      .number()
      .optional()
      .describe("Risk Register ID. Defaults to DRATA_RISK_REGISTER_ID env var."),
    riskId: z.number().describe("ID of the risk"),
    noteId: z.string().describe("UUID of the note to update"),
    comment: z.string().describe("Updated note comment text"),
  },
  async ({ riskRegisterId, riskId, noteId, comment }) => {
    const response = await updateRiskNote(riskRegisterId, riskId, noteId, comment);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default UpdateRiskNoteTool;
