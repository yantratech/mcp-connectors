import { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { ToolDefinition } from "../types/tool-definition.js";

// yantra-spend's surface is small: read-only analytics tools. Each known
// read gets inferred read-only+idempotent annotations, so this map can stay
// tight; a tool can still pass explicit annotations at the call site.
const READ_TOOL_NAMES = new Set([
  "health",
  "spend_summary",
  "spend_by_source",
  "top_movers",
  "anomalies",
  "forecast_month_end",
]);

function inferAnnotations(name: string): ToolAnnotations | undefined {
  if (READ_TOOL_NAMES.has(name)) {
    return { readOnlyHint: true, idempotentHint: true };
  }
  return undefined;
}

export const CreateYantraSpendTool =
  <Args extends ZodRawShapeCompat>(
    name: string,
    description: string,
    schema: Args,
    handler: ToolCallback<Args>,
    annotations?: ToolAnnotations,
  ): (() => ToolDefinition<ZodRawShapeCompat>) =>
  () => ({
    name,
    description,
    schema,
    annotations: annotations ?? inferAnnotations(name),
    handler,
  });
