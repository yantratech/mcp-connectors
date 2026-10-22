#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { KandjiMcpServer } from "./server/kandji-mcp-server.js";
import { ToolFactory } from "./tools/tool-factory.js";

const main = async () => {
  const server = KandjiMcpServer.GetServer();

  ToolFactory(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
};

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
