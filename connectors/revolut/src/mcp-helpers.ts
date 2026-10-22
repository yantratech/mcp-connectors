/**
 * Shared plumbing for tool registration: the context handed to every tool
 * and the MCP result-shape helpers. Single-resource get tools keep the raw
 * Revolut field names unchanged; list tools may project rows to a compact
 * shape (opting back into raw records via a `detail` flag).
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { RevolutConfig } from "./config.js";
import type { RevolutClient } from "./client.js";
import { auditLog } from "./logger.js";

export interface ToolContext {
  config: RevolutConfig;
  client: RevolutClient;
  /** Append one audit line to stderr (tool, operator, timestamp, target IDs). */
  log: (tool: string, info?: Record<string, unknown>) => void;
}

export function createContext(
  config: RevolutConfig,
  client: RevolutClient,
): ToolContext {
  return {
    config,
    client,
    log: (tool, info) => auditLog(tool, config.operator, info),
  };
}

export interface ToolResult {
  // The SDK's CallToolResult carries a string index signature; mirror it so
  // our helpers' return type is assignable to a tool handler's return type.
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export function ok(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

/** Like ok() but single-line JSON — for list payloads where the ~30% pretty-print overhead matters. */
export function okCompact(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
}

export function fail(message: string): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `Error: ${message}` }],
  };
}

/** Turn an unknown thrown value into a readable string. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
};

/**
 * The single write tool. A draft is inert until a human approves it in the
 * Revolut Business app, so it is neither read-only nor destructive.
 */
export const CREATE_DRAFT: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
};

/**
 * Register a tool with a STRICT input schema. Passing a raw shape to
 * server.tool() lets the SDK wrap it in a default z.object, which silently
 * STRIPS unknown argument keys: a misspelled or unsupported argument (say
 * `acount_id`) would be dropped and the call would run unfiltered. .strict()
 * turns that into an MCP -32602 validation error naming the unknown key.
 */
export function registerStrictTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  shape: Shape,
  annotations: ToolAnnotations,
  handler: (args: z.infer<z.ZodObject<Shape>>) => Promise<ToolResult>,
): void {
  server.registerTool(
    name,
    {
      description,
      inputSchema: z.object(shape).strict(),
      annotations,
    },
    handler as unknown as Parameters<typeof server.registerTool>[2],
  );
}
