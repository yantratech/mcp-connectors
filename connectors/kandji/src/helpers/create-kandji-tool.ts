import { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

// Maps tool-name prefixes to MCP ToolAnnotations so clients (Cowork, Claude
// Desktop, etc.) can categorise read / write / destructive without parsing
// names themselves. Order matters: longer/more-specific prefixes first.
//
// Note: a handful of `get-*` tools (filevault-recovery-key, unlock-pin,
// recovery-lock-password, activation-lock-bypass-code) return sensitive
// secrets but are still pure reads. Sensitivity is a separate concern from
// MCP's read/write/destructive hint, so they stay readOnly.
const PREFIX_ANNOTATIONS: ReadonlyArray<readonly [string, ToolAnnotations]> = [
  ["list_", { readOnlyHint: true, idempotentHint: true }],
  ["get_", { readOnlyHint: true, idempotentHint: true }],
  ["prism_", { readOnlyHint: true, idempotentHint: true }],
  ["test_", { readOnlyHint: true, idempotentHint: true }],
  ["update_", { readOnlyHint: false, destructiveHint: false, idempotentHint: true }],
];

export function inferAnnotations(name: string): ToolAnnotations | undefined {
  for (const [prefix, annotations] of PREFIX_ANNOTATIONS) {
    if (name.startsWith(prefix)) return annotations;
  }
  return undefined;
}

export const CreateKandjiTool =
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
    handler: handler,
  });
