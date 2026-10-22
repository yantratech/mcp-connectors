import { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { collectAuditWarnings } from "../clients/drata-client.js";

// Maps tool-name prefixes to MCP ToolAnnotations so clients (Cowork, Claude
// Desktop, etc.) can categorise read / write / destructive without parsing
// names themselves. Order matters: longer/more-specific prefixes first.
const PREFIX_ANNOTATIONS: ReadonlyArray<readonly [string, ToolAnnotations]> = [
  ["bulk_update_", { readOnlyHint: false, destructiveHint: true, idempotentHint: false }],
  ["run_gap_analysis", { readOnlyHint: true, idempotentHint: true }],
  ["list_", { readOnlyHint: true, idempotentHint: true }],
  ["get_", { readOnlyHint: true, idempotentHint: true }],
  ["check_", { readOnlyHint: true, idempotentHint: true }],
  ["search_", { readOnlyHint: true, idempotentHint: true }],
  ["scan_", { readOnlyHint: true, idempotentHint: true }],
  ["acknowledge_", { readOnlyHint: false, destructiveHint: false, idempotentHint: true }],
  ["archive_", { readOnlyHint: false, destructiveHint: true, idempotentHint: true }],
  ["create_", { readOnlyHint: false, destructiveHint: false, idempotentHint: false }],
  ["update_", { readOnlyHint: false, destructiveHint: false, idempotentHint: true }],
  ["modify_", { readOnlyHint: false, destructiveHint: false, idempotentHint: true }],
  ["upsert_", { readOnlyHint: false, destructiveHint: false, idempotentHint: true }],
  ["add_", { readOnlyHint: false, destructiveHint: false, idempotentHint: false }],
  ["fulfil_", { readOnlyHint: false, destructiveHint: false, idempotentHint: false }],
  ["perform_", { readOnlyHint: false, destructiveHint: false, idempotentHint: false }],
  ["push_", { readOnlyHint: false, destructiveHint: false, idempotentHint: false }],
  ["send_", { readOnlyHint: false, destructiveHint: false, idempotentHint: false }],
  ["upload_", { readOnlyHint: false, destructiveHint: false, idempotentHint: false }],
  ["delete_", { readOnlyHint: false, destructiveHint: true, idempotentHint: true }],
  ["remove_", { readOnlyHint: false, destructiveHint: true, idempotentHint: true }],
];

export function inferAnnotations(name: string): ToolAnnotations | undefined {
  for (const [prefix, annotations] of PREFIX_ANNOTATIONS) {
    if (name.startsWith(prefix)) return annotations;
  }
  return undefined;
}

// A request Drata has answered can still fail to reach DRATA_MCP_AUDIT_LOG
// (see auditMutation in the client). Keep the handler's result, including
// Drata's response, unchanged and append the warnings as one more text block,
// so a caller can tell an applied change apart from a failed one.
function withAuditWarnings<Args extends ZodRawShapeCompat>(
  handler: ToolCallback<Args>,
): ToolCallback<Args> {
  const run = handler as (
    ...args: unknown[]
  ) => CallToolResult | Promise<CallToolResult>;
  return (async (...args: unknown[]) => {
    const { result, warnings } = await collectAuditWarnings(() => run(...args));
    if (warnings.length === 0) return result;
    return {
      ...result,
      content: [
        ...result.content,
        { type: "text" as const, text: warnings.join("\n") },
      ],
    };
  }) as ToolCallback<Args>;
}

export const CreateDrataTool =
  <Args extends ZodRawShapeCompat>(
    name: string,
    description: string,
    schema: Args,
    handler: ToolCallback<Args>,
    annotations?: ToolAnnotations,
  ): (() => ToolDefinition<ZodRawShapeCompat>) =>
  () => ({
    name: name,
    description: description,
    schema: schema,
    annotations: annotations ?? inferAnnotations(name),
    handler: withAuditWarnings(handler),
  });
