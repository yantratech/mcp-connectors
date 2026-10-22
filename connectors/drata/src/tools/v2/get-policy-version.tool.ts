import { z } from "zod";
import { getPolicyVersion } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const VersionExpand = z.enum([
  "owner",
  "weekTimeFrameSlas",
  "p3MatrixSlas",
  "gracePeriodSlas",
  "downloadUrl",
  "downloadPdfUrl",
]);

const GetPolicyVersionTool = CreateDrataTool(
  "get_policy_version",
  "Get metadata for a specific policy version.",
  {
    policyId: z.number().describe("ID of the policy"),
    policyVersionId: z.number().describe("ID of the policy version"),
    expand: z
      .array(VersionExpand)
      .optional()
      .describe("Related fields to expand"),
  },
  async ({ policyId, policyVersionId, expand }) => {
    const response = await getPolicyVersion(policyId, policyVersionId, { expand });
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default GetPolicyVersionTool;
