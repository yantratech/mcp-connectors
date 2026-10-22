import { z } from "zod";
import { getPolicyVersionContent } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const GetPolicyVersionContentTool = CreateDrataTool(
  "get_policy_version_content",
  "Get the raw HTML content of a policy version, prefixed with an identifying metadata block (policy name/status, version status, current flag, contentChars). Content can be a never-published DRAFT — check policyVersionStatus/currentVersion before quoting it as company policy.",
  {
    policyId: z.number().describe("ID of the policy"),
    policyVersionId: z.number().describe("ID of the policy version"),
  },
  async ({ policyId, policyVersionId }) => {
    const response = await getPolicyVersionContent(policyId, policyVersionId);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    // Metadata block FIRST, HTML second: a client that truncates the tail
    // cuts policy prose, never the block identifying what was fetched.
    const { html, ...metadata } = response.result;
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(metadata, null, 2) },
        { type: "text" as const, text: html },
      ],
    };
  },
);

export default GetPolicyVersionContentTool;
