import { z } from "zod";
import { performPolicyAction } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const PerformPolicyActionTool = CreateDrataTool(
  "perform_policy_action",
  "Advance a policy through its approval/publish lifecycle. V2 can drive SubmitForApproval/Approve/Publish-style workflow actions and read policy version PDFs, but no policy-upload endpoint is documented. Write operation — requires explicit user approval.",
  {
    policyId: z.number().describe("ID of the policy"),
    action: z
      .enum([
        "SubmitForApproval",
        "Approve",
        "RequestChanges",
        "OverrideApprove",
        "Publish",
        "Discard",
      ])
      .describe("Workflow action to perform"),
    reason: z
      .string()
      .optional()
      .describe("Reason for the action (required when action=RequestChanges)"),
    overrideReason: z
      .string()
      .optional()
      .describe(
        "Override justification (required when action=OverrideApprove)",
      ),
  },
  async ({ policyId, action, reason, overrideReason }) => {
    if (action === "RequestChanges" && !reason) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Error: 'reason' is required when action is 'RequestChanges'.",
          },
        ],
      };
    }
    if (action === "OverrideApprove" && !overrideReason) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Error: 'overrideReason' is required when action is 'OverrideApprove'.",
          },
        ],
      };
    }

    const body: Record<string, unknown> = { action };
    if (reason !== undefined) body.reason = reason;
    if (overrideReason !== undefined) body.overrideReason = overrideReason;

    const response = await performPolicyAction(policyId, body);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
  // The `Discard` action removes the in-progress policy version, so flag the
  // tool as destructive even though most actions just advance the workflow.
  { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
);

export default PerformPolicyActionTool;
