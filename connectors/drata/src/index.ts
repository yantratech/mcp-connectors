#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DrataMcpServer } from "./server/drata-mcp-server.js";
import { ToolFactory } from "./tools/tool-factory.js";
import { getDrataClient } from "./clients/drata-client.js";
import { detectUnentitledGroups } from "./helpers/entitlements.js";

function hideUnentitledEnabled(): boolean {
  const value = process.env.DRATA_HIDE_UNENTITLED_TOOLS;
  return value === "1" || value?.toLowerCase() === "true";
}

const main = async () => {
  const server = DrataMcpServer.GetServer();

  // Probe plan entitlements once at startup so plan-gated tools are flagged
  // (or hidden) instead of advertised identically to working ones. Fail open:
  // any probe failure leaves every group entitled.
  let unentitledGroups = new Set<string>();
  try {
    unentitledGroups = await detectUnentitledGroups(getDrataClient());
    if (unentitledGroups.size > 0) {
      console.error(
        `Drata MCP: plan-gated feature groups detected (HTTP 402): ${[...unentitledGroups].join(", ")}.` +
          (hideUnentitledEnabled()
            ? " DRATA_HIDE_UNENTITLED_TOOLS is set — these tools will not be registered."
            : " Their tools are registered but marked unavailable; set DRATA_HIDE_UNENTITLED_TOOLS=true to hide them."),
      );
    }
  } catch (error) {
    console.error(
      "Drata MCP: entitlement probe skipped (failing open, all tools registered):",
      error instanceof Error ? error.message : error,
    );
  }

  ToolFactory(server, {
    unentitledGroups,
    hideUnentitled: hideUnentitledEnabled(),
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
};

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
