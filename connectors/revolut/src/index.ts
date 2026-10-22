#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { readTokenStore } from "./auth.js";
import { RevolutClient } from "./client.js";
import { createContext } from "./mcp-helpers.js";
import { startupLog } from "./logger.js";
import { registerAccountTools } from "./tools/accounts.js";
import { registerTransactionTools } from "./tools/transactions.js";
import { registerCounterpartyTools } from "./tools/counterparties.js";
import { registerPaymentDraftTools } from "./tools/payment-drafts.js";

const SERVER_NAME = "yantratech-revolut-mcp-server";

/**
 * The version in this package's package.json (one level above dist/), so the
 * serverInfo reported to clients always matches the installed release.
 */
function packageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: unknown };
    if (typeof pkg.version === "string" && pkg.version !== "") {
      return pkg.version;
    }
  } catch {
    /* reported below */
  }
  startupLog(
    "warning: could not read the version from package.json; reporting 0.0.0",
  );
  return "0.0.0";
}

const main = async (): Promise<void> => {
  const config = loadConfig();

  // Fail fast with an actionable message if the operator hasn't run the
  // one-time consent flow yet.
  readTokenStore(config);

  const client = new RevolutClient(config);
  const ctx = createContext(config, client);

  const version = packageVersion();
  const server = new McpServer({ name: SERVER_NAME, version });

  registerAccountTools(server, ctx);
  registerTransactionTools(server, ctx);
  registerCounterpartyTools(server, ctx);
  registerPaymentDraftTools(server, ctx);

  startupLog(
    `${SERVER_NAME} ${version} ready — env=${config.env}, operator="${config.operator}", ` +
      `api=${config.apiBaseUrl}. Read tools + create_payment_draft only; this ` +
      `server never moves money.`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
};

main().catch((error) => {
  console.error(
    `[revolut-mcp] fatal: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
