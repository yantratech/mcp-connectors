import { z } from "zod";
import { acknowledgeAssignedPolicy } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const AcknowledgeAssignedPolicyTool = CreateDrataTool(
  "acknowledge_assigned_policy",
  "Record a user's acknowledgement of an assigned policy. Write operation — requires explicit user approval.",
  {
    userId: z.number().describe("ID of the user acknowledging the policy"),
    policyId: z.number().describe("ID of the policy being acknowledged"),
    acceptedAt: z
      .string()
      .optional()
      .describe(
        "ISO 8601 timestamp of acknowledgement. Defaults to the current time.",
      ),
    details: z.string().optional().describe("Optional acknowledgement note"),
  },
  async ({ userId, policyId, acceptedAt, details }) => {
    const body: { acceptedAt: string; details?: string } = {
      acceptedAt: acceptedAt ?? new Date().toISOString(),
    };
    if (details !== undefined) body.details = details;
    const response = await acknowledgeAssignedPolicy(userId, policyId, body);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default AcknowledgeAssignedPolicyTool;
