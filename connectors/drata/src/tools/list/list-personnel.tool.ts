import { z } from "zod";
import { listPersonnel } from "../../handlers/list-entities.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ListPersonnelTool = CreateDrataTool(
  "list_personnel",
  "List all personnel in Drata. Each row carries complianceChecks — Drata's own per-person check verdicts as a {TYPE: STATUS} map (e.g. FULL_COMPLIANCE / ACCEPTED_POLICIES / BG_CHECK / SECURITY_TRAINING → PASS / FAIL / EXCLUDED, where EXCLUDED means not applicable). Compact by default: the per-person backgroundChecks[] and documents[] arrays are summarized as backgroundChecksCount / documentsCount to stay under the output cap on large orgs. Use `fields` to project only the columns you need, or to opt the full heavy arrays back in (e.g. [\"firstName\",\"backgroundChecks\"]).",
  {
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Return only these fields per person, e.g. ["id","firstName","lastName","email"]. ' +
          'Include "backgroundChecks" or "documents" to restore the full nested arrays (dropped by default).',
      ),
  },
  async ({ fields }) => {
    const response = await listPersonnel({ fields });
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListPersonnelTool;
