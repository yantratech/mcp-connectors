import { z } from "zod";
import { listPolicyActions } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ListPolicyActionsTool = CreateDrataTool(
  "list_policy_actions",
  "List workflow actions the caller can perform on a policy (SubmitForApproval, Approve, RequestChanges, OverrideApprove, Publish, Discard).",
  {
    policyId: z.number().describe("ID of the policy"),
  },
  async ({ policyId }) => {
    const response = await listPolicyActions(policyId);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListPolicyActionsTool;
