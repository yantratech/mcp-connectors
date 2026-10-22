import { z } from "zod";
import { createRiskNote } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const CreateRiskNoteTool = CreateDrataTool(
  "create_risk_note",
  "Create a note on a risk (V2). The note text goes in the `comment` field. Works on the base tier once a riskRegisterId is known — pass riskRegisterId or set DRATA_RISK_REGISTER_ID; only the register enumerator (list_risk_registers) is Pro-gated.",
  {
    riskRegisterId: z
      .number()
      .optional()
      .describe("Risk Register ID. Defaults to DRATA_RISK_REGISTER_ID env var."),
    riskId: z.number().describe("ID of the risk"),
    comment: z.string().describe("Note comment text"),
  },
  async ({ riskRegisterId, riskId, comment }) => {
    const response = await createRiskNote(riskRegisterId, riskId, comment);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default CreateRiskNoteTool;
