import { z } from "zod";
import { listExternalEvidence } from "../../handlers/write-evidence.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ListExternalEvidenceTool = CreateDrataTool(
  "list_external_evidence",
  "List external evidence attached to a specific control. Caveat: upstream returns 200-empty for nonexistent controlId too (flagged with a note) — verify the control via get_control before asserting it has no evidence. External evidence only; policy/monitor-derived evidence shows in check_control_status.",
  {
    controlId: z.number().describe("The control ID to list evidence for"),
  },
  async ({ controlId }) => {
    const response = await listExternalEvidence(controlId);
    if (response.isError) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${response.error}` }],
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(response.result, null, 2),
        },
      ],
    };
  },
);

export default ListExternalEvidenceTool;
