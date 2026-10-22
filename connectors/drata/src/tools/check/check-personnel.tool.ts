import { z } from "zod";
import { checkPersonnel } from "../../handlers/check-personnel.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const CheckPersonnelTool = CreateDrataTool(
  "check_personnel_compliance",
  "Check personnel compliance using Drata's own per-person compliance checks. missingPolicyAck / missingBgCheck / missingTraining mirror Drata's ACCEPTED_POLICIES / BG_CHECK / SECURITY_TRAINING check results, and isCompliant mirrors Drata's FULL_COMPLIANCE rollup (EXCLUDED checks are not applicable, never counted as missing). Device/agent posture checks (AGENT_INSTALLED, HDD_ENCRYPTION, ANTIVIRUS, ...) are surfaced per person under failedChecks. Scores current employees/contractors by default; former employees, service accounts, and bots are summarized separately under nonCurrent.",
  {
    includeNonCurrent: z
      .boolean()
      .optional()
      .describe(
        "Also score former employees, service accounts, and other non-current personnel (excluded from compliance counts by default; check employmentStatus on each entry).",
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Opt heavy per-person arrays back in: any of "backgroundChecks", "documents", "complianceChecks" (raw Drata check objects). Compacted to counts by default.',
      ),
  },
  async ({ includeNonCurrent, fields }) => {
    const response = await checkPersonnel({ includeNonCurrent, fields });

    if (response.isError) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${response.error}` }],
      };
    }

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(response.result, null, 2) },
      ],
    };
  },
);

export default CheckPersonnelTool;
