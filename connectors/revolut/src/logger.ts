/**
 * Local audit trail. The stdio transport reserves stdout for the MCP protocol,
 * so ALL logging goes to stderr. We log one JSON line per tool call recording
 * the tool name, operator, timestamp, and the target IDs involved — never
 * tokens, never full bank details, never request bodies.
 */

/** Redact anything that looks like a token/secret before it can reach a log. */
function safe(value: unknown): unknown {
  if (typeof value === "string") {
    // Revolut tokens are long opaque strings prefixed oa_prod_/oa_sand_.
    if (/^oa_(prod|sand)_/.test(value)) return "<redacted>";
  }
  return value;
}

export function auditLog(
  tool: string,
  operator: string,
  info: Record<string, unknown> = {},
): void {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    tool,
    operator,
  };
  for (const [key, value] of Object.entries(info)) {
    if (value !== undefined) entry[key] = safe(value);
  }
  process.stderr.write(`${JSON.stringify(entry)}\n`);
}

/** One-time startup notice on stderr. */
export function startupLog(message: string): void {
  process.stderr.write(`[revolut-mcp] ${message}\n`);
}
