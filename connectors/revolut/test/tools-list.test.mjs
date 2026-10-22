/**
 * Offline stdio smoke test: spawn the compiled server and exercise tools/list
 * through the real MCP protocol. No network — dummy credentials and a temp
 * token store are supplied; tools/list never touches the Revolut API.
 *
 * Run: node --test test/tools-list.test.mjs
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST_ENTRY = path.join(HERE, "..", "dist", "index.js");
const PKG = JSON.parse(readFileSync(path.join(HERE, "..", "package.json"), "utf8"));

const EXPECTED_TOOL_COUNT = 9;
const NAME_PATTERN = /^[a-z0-9_]+$/;
const READ_ONLY_PREFIXES = ["list_", "get_"];

const EXPECTED_NAMES = [
  "list_accounts",
  "get_account",
  "list_transactions",
  "get_transaction",
  "list_counterparties",
  "get_counterparty",
  "create_payment_draft",
  "list_payment_drafts",
  "get_payment_draft",
];

let client;
let tools;
let serverInfo;

before(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "revolut-mcp-test-"));
  const keyPath = path.join(dir, "privatecert.pem");
  writeFileSync(
    keyPath,
    "-----BEGIN PRIVATE KEY-----\ndummy\n-----END PRIVATE KEY-----\n",
  );
  writeFileSync(
    path.join(dir, "tokens-sandbox.json"),
    JSON.stringify({
      refresh_token: "oa_sand_dummy_refresh",
      access_token: "oa_sand_dummy_access",
      access_token_expires_at: Date.now() + 3_600_000,
    }),
  );

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [DIST_ENTRY],
    env: {
      PATH: process.env.PATH ?? "",
      REVOLUT_ENV: "sandbox",
      REVOLUT_CLIENT_ID: "dummy-client-id",
      REVOLUT_PRIVATE_KEY_PATH: keyPath,
      REVOLUT_JWT_ISS: "example.com",
      REVOLUT_OPERATOR: "tester",
      REVOLUT_TOKEN_DIR: dir,
    },
  });

  client = new Client({ name: "revolut-tools-list-smoke", version: "1.0.0" }, {});
  await client.connect(transport);
  serverInfo = client.getServerVersion();

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

describe("tools/list over stdio", () => {
  it("reports its package name and package.json version as serverInfo", () => {
    assert.equal(serverInfo?.name, "yantratech-revolut-mcp-server");
    assert.equal(serverInfo?.version, PKG.version);
  });

  it("exposes the optional app-inclusive draft source filter after a fresh startup", () => {
    const draft = tools.find((t) => t.name === "list_payment_drafts");
    assert.deepEqual(draft.inputSchema.properties.source.enum, ["api", "integration", "email", "all"]);
    assert.ok(!(draft.inputSchema.required ?? []).includes("source"));
    assert.equal(draft.annotations.readOnlyHint, true);
    assert.match(draft.description, /not an approved scheduled payment/);
  });

  it(`registers exactly ${EXPECTED_TOOL_COUNT} tools`, () => {
    assert.equal(tools.length, EXPECTED_TOOL_COUNT);
  });

  it("registers exactly the expected tool names", () => {
    assert.deepEqual(tools.map((t) => t.name).sort(), [...EXPECTED_NAMES].sort());
  });

  it("every tool name is snake_case", () => {
    const bad = tools.filter((t) => !NAME_PATTERN.test(t.name)).map((t) => t.name);
    assert.deepEqual(bad, []);
  });

  it("every tool has a non-empty description and an object inputSchema", () => {
    for (const t of tools) {
      assert.ok(t.description && t.description.trim() !== "", `${t.name} description`);
      assert.equal(t.inputSchema?.type, "object", `${t.name} inputSchema`);
    }
  });

  it("every list_*/get_* tool is annotated read-only", () => {
    const offenders = tools
      .filter((t) => READ_ONLY_PREFIXES.some((p) => t.name.startsWith(p)))
      .filter((t) => t.annotations?.readOnlyHint !== true)
      .map((t) => t.name);
    assert.deepEqual(offenders, []);
  });

  it("create_payment_draft is NOT read-only and NOT destructive", () => {
    const draft = tools.find((t) => t.name === "create_payment_draft");
    assert.ok(draft, "create_payment_draft missing");
    assert.notEqual(draft.annotations?.readOnlyHint, true);
    assert.notEqual(draft.annotations?.destructiveHint, true);
  });

  it("no tool named to move money, delete drafts, or write counterparties", () => {
    // Segment-aware: matches a name whose whole segment is a forbidden verb
    // (e.g. `pay`, `make_transfer`, `delete_draft`) — not the substring `pay`
    // inside `payment`.
    const forbidden = /(^|_)(pay|transfer|exchange|payout|payouts|delete|remove)(_|$)/;
    const bad = tools
      .filter((t) => t.name !== "create_payment_draft")
      .filter((t) => forbidden.test(t.name))
      .map((t) => t.name);
    assert.deepEqual(bad, [], "found a tool whose name implies a forbidden operation");
  });
});
