import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { ReadTools } from "./read/index.js";

export function ToolFactory(server: McpServer) {
  const allToolGroups = [ReadTools];

  for (const group of allToolGroups) {
    for (const factory of group) {
      const tool = factory();
      if (tool.annotations) {
        server.tool(
          tool.name,
          tool.description,
          tool.schema,
          tool.annotations,
          tool.handler,
        );
      } else {
        server.tool(tool.name, tool.description, tool.schema, tool.handler);
      }
    }
  }
}
