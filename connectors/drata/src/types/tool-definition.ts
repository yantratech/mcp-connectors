import { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ZodRawShapeCompat,
  AnySchema,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export interface ToolDefinition<
  Args extends undefined | ZodRawShapeCompat | AnySchema = undefined,
> {
  name: string;
  description: string;
  schema: Args;
  annotations?: ToolAnnotations;
  handler: ToolCallback<Args>;
}
