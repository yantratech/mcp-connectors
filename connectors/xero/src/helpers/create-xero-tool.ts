import { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

// Maps tool-name prefixes to MCP ToolAnnotations so clients (Cowork, Claude
// Desktop, etc.) can categorise read / write / destructive without parsing
// names themselves. Order matters: longer/more-specific prefixes first.
const PREFIX_ANNOTATIONS: ReadonlyArray<readonly [string, ToolAnnotations]> = [
  ["batch_create_", { readOnlyHint: false, destructiveHint: false, idempotentHint: false }],
  ["list_", { readOnlyHint: true, idempotentHint: true }],
  ["get_", { readOnlyHint: true, idempotentHint: true }],
  // Reads from Xero but WRITES the local filesystem at a caller-chosen path
  // (and can replace an existing file when overwrite is true), so these are
  // destructive, non-idempotent local writes, not reads.
  ["download_", { readOnlyHint: false, destructiveHint: true, idempotentHint: false }],
  // prepare_attachment: creates/appends its own temp file only; no Xero call.
  [
    "prepare_",
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  ],
  ["create_", { readOnlyHint: false, destructiveHint: false, idempotentHint: false }],
  ["update_", { readOnlyHint: false, destructiveHint: false, idempotentHint: true }],
  ["approve_", { readOnlyHint: false, destructiveHint: false, idempotentHint: true }],
  ["add_", { readOnlyHint: false, destructiveHint: false, idempotentHint: false }],
  ["upload_", { readOnlyHint: false, destructiveHint: false, idempotentHint: false }],
  ["delete_", { readOnlyHint: false, destructiveHint: true, idempotentHint: true }],
  ["void_", { readOnlyHint: false, destructiveHint: true, idempotentHint: true }],
  ["archive_", { readOnlyHint: false, destructiveHint: true, idempotentHint: true }],
  ["revert_", { readOnlyHint: false, destructiveHint: true, idempotentHint: false }],
];

export function inferAnnotations(name: string): ToolAnnotations | undefined {
  for (const [prefix, annotations] of PREFIX_ANNOTATIONS) {
    if (name.startsWith(prefix)) return annotations;
  }
  return undefined;
}

export const CreateXeroTool =
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
