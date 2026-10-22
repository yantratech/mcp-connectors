import { z } from "zod";
import {
  getPolicy,
  getPolicyApprovalConfiguration,
} from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const PolicyExpand = z.enum([
  "groups",
  "controls",
  "weekTimeFrameSlas",
  "gracePeriodSlas",
  "p3MatrixSlas",
  "owner",
]);

const GetPolicyTool = CreateDrataTool(
  "get_policy",
  "Get details of a specific policy (V2). Caveats: approvedAt mirrors the CURRENT version only — it is null when the current version was published without re-approval (e.g. a typo-fix minor version), so check list_policy_versions before calling an ACTIVE policy unapproved. expand=controls returns Drata TEMPLATE data (unresolved '%s' company placeholders, isReady: null) — do not quote it as tenant control state.",
  {
    policyId: z.number().describe("ID of the policy"),
    expand: z
      .array(PolicyExpand)
      .optional()
      .describe("Related fields to expand in the response"),
  },
  async ({ policyId, expand }) => {
    const response = await getPolicy(policyId, { expand });
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

// Registered via OperationalCoverageTools (operational-coverage.tools.ts).
export const GetPolicyApprovalConfigurationTool = CreateDrataTool(
  "get_policy_approval_configuration",
  "Get the review-group approval configuration (approval tiers) for a policy (V2).",
  {
    policyId: z.number().describe("ID of the policy"),
  },
  async ({ policyId }) => {
    const response = await getPolicyApprovalConfiguration(policyId);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default GetPolicyTool;
