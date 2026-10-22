#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import { YantraSpendMcpServer } from "./server/yantra-spend-mcp-server.js";
import { ToolFactory } from "./tools/tool-factory.js";
import { maskCredentials } from "./helpers/format-error.js";

// Load credentials from `<connector-dir>/.env` regardless of the cwd that
// launched us. MCP clients such as Claude Desktop start the bin with cwd set
// to the user's home or the app bundle, not the connector dir, so the
// default cwd-relative `dotenv.config()` would silently find no creds.
//
// Layout: dist/index.js  →  ../.env  (the connector root holds the .env)
//
// This only helps a source checkout. Under npx the package root is in npm's
// cache, which holds no .env, so credentials must come from the MCP client's
// env block. Variables already set in the environment take precedence.
const here = path.dirname(fileURLToPath(import.meta.url));
// quiet: dotenv >=17 logs an injection tip to STDOUT by default, which
// corrupts the MCP stdio protocol channel.
dotenv.config({ path: path.resolve(here, "..", ".env"), quiet: true });

const main = async () => {
  const server = YantraSpendMcpServer.GetServer();

  ToolFactory(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
};

main().catch((error) => {
  // Mask any credential-shaped substring before it reaches stderr — stdio MCP
  // hosts commonly capture stderr into log files, and a startup failure during
  // credential resolution (SDK/dotenv) could carry a value in its message or
  // cause chain. Match the masking discipline every handler already applies.
  console.error(
    "Error:",
    maskCredentials(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    ),
  );
  process.exit(1);
});
