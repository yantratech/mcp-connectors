/**
 * MCP smoke test: spawn the compiled server (dist/index.js) over stdio with a
 * real MCP client and check what it reports in the initialize handshake and in
 * tools/list. Fully offline: neither initialize nor tools/list calls a
 * provider API, so no credentials are needed.
 *
 * Run: node --test test/tools-list.test.js   (requires `npm run build` first)
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER_PATH = fileURLToPath(new URL("../dist/index.js", import.meta.url));

let client;
let tools;

before(async () => {
  client = new Client({ name: "yantra-spend-tools-list-smoke", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    // PATH only: no provider credentials are passed to the child.
    env: { PATH: process.env.PATH ?? "" },
  });
  await client.connect(transport);

  // Collect all pages, in case the server ever starts paginating tools/list.
  tools = [];
  let cursor;
  do {
    const page = await client.listTools(cursor ? { cursor } : {});
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
});

after(async () => {
  await client?.close();
});

describe("yantra-spend over stdio", () => {
  it("serverInfo names the package and reports the package.json version", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    const info = client.getServerVersion();
    assert.equal(info?.name, "yantratech-yantra-spend-mcp-server");
    assert.equal(info?.version, pkg.version);
  });

  it("tools/list returns the six read-only tools", () => {
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "anomalies",
      "forecast_month_end",
      "health",
      "spend_by_source",
      "spend_summary",
      "top_movers",
    ]);
    for (const tool of tools) {
      assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} must be read-only`);
    }
  });
});
