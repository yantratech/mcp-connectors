/**
 * Offline MCP smoke test.
 *
 * Spawns the compiled server (dist/index.js) over stdio with dummy
 * credentials and inspects the tools/list response, once for every
 * combination of the opt-in flags. No Xero account and no network access are
 * required: tools/list never touches the Xero API, and the dummy env vars
 * exist only to satisfy the xero-client module-init guard.
 *
 * Run via `npm test` (node --test test/*.test.mjs) after `npm run build`.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { getClientHeaders } from "../dist/helpers/get-client-headers.js";

const SERVER_ENTRY = fileURLToPath(
  new URL("../dist/index.js", import.meta.url),
);

// 153 tools exist. Two opt-in sets are registered only on request, because
// the scopes they need are not requested by default (src/consts/xero-scopes.ts
// says why): the 3 receipt tools with XERO_ENABLE_RECEIPTS=1 (the deprecated
// accounting.transactions scopes) and the 2 journal tools with
// XERO_ENABLE_JOURNALS=1 (accounting.journals.read).
const RECEIPT_TOOLS = ["list_receipts", "get_receipt", "create_receipt"];
const JOURNAL_TOOLS = ["list_journals", "get_journal"];

// Every combination of the opt-in flags: the env it sets, the tool count it
// must expose, and the opt-in tools it must add to the default set.
const COMBINATIONS = {
  default: { env: {}, count: 148, adds: [] },
  receipts: {
    env: { XERO_ENABLE_RECEIPTS: "1" },
    count: 151,
    adds: RECEIPT_TOOLS,
  },
  journals: {
    env: { XERO_ENABLE_JOURNALS: "1" },
    count: 150,
    adds: JOURNAL_TOOLS,
  },
  both: {
    env: { XERO_ENABLE_RECEIPTS: "1", XERO_ENABLE_JOURNALS: "1" },
    count: 153,
    adds: [...RECEIPT_TOOLS, ...JOURNAL_TOOLS],
  },
};
const EXPECTED_TOOL_COUNT = COMBINATIONS.default.count;
const SNAKE_CASE = /^[a-z0-9_]+$/;

// A representative cross-section of the surface: reads, gets, writes,
// batches, destructive operations, FX, and attachments.
const KNOWN_TOOL_NAMES = [
  "list_invoices",
  "list_contacts",
  "get_invoice",
  "get_fx_rate",
  "create_contact",
  "create_invoice",
  "batch_create_invoices",
  "update_invoice",
  "void_invoice",
  "archive_account",
  "delete_payment",
  "upload_attachment",
];

// Starts the server with dummy credentials: enough to boot it, never used by
// tools/list. The empty bearer token pins the client-credentials code path
// even if a local .env defines XERO_CLIENT_BEARER_TOKEN, and the empty
// opt-in flags pin the default configuration the same way unless `flags`
// sets them.
async function connect(name, flags) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    env: {
      ...process.env,
      XERO_CLIENT_ID: "offline-test-id",
      XERO_CLIENT_SECRET: "offline-test-secret",
      XERO_CLIENT_BEARER_TOKEN: "",
      XERO_ENABLE_RECEIPTS: "",
      XERO_ENABLE_JOURNALS: "",
      ...flags,
    },
  });
  const mcpClient = new Client({ name, version: "1.0.0" }, {});
  await mcpClient.connect(transport);
  return mcpClient;
}

const clients = [];
const listings = {}; // combination name -> tools/list result
let client; // the server in its default configuration
let tools; // its tools/list result
let byName;
let allTools; // tools/list with both opt-ins: every tool the server has

before(async () => {
  // allSettled, not all: when one server fails to start or to list its tools,
  // wait for the others to connect (and land in `clients`) before failing.
  // Promise.all would reject first, `after` would close only the clients
  // connected so far, and the servers still starting would keep the test
  // process alive, so the run would hang instead of failing.
  const results = await Promise.allSettled(
    Object.entries(COMBINATIONS).map(async ([name, { env }]) => {
      const mcpClient = await connect(`offline-smoke-${name}`, env);
      clients.push(mcpClient);
      if (name === "default") client = mcpClient;
      ({ tools: listings[name] } = await mcpClient.listTools());
    }),
  );
  const failure = results.find((r) => r.status === "rejected");
  if (failure) throw failure.reason;
  tools = listings.default;
  byName = new Map(tools.map((t) => [t.name, t]));
  allTools = listings.both;
});

after(async () => {
  await Promise.all(clients.map((c) => c.close()));
});

describe("tools/list inventory", () => {
  it(`exposes exactly ${EXPECTED_TOOL_COUNT} tools by default`, () => {
    assert.equal(tools.length, EXPECTED_TOOL_COUNT);
  });

  it("has no duplicate tool names in any configuration", () => {
    for (const [name, list] of Object.entries(listings)) {
      assert.equal(new Set(list.map((t) => t.name)).size, list.length, name);
    }
  });

  it("uses snake_case for every tool name", () => {
    const offenders = allTools
      .map((t) => t.name)
      .filter((name) => !SNAKE_CASE.test(name));
    assert.deepEqual(offenders, []);
  });

  it("exposes the expected well-known tools", () => {
    const missing = KNOWN_TOOL_NAMES.filter((name) => !byName.has(name));
    assert.deepEqual(missing, []);
  });

  it("does not register the receipt or journal tools by default", () => {
    assert.deepEqual(
      [...RECEIPT_TOOLS, ...JOURNAL_TOOLS].filter((name) => byName.has(name)),
      [],
    );
  });
});

describe("tools/list for each combination of the opt-in flags", () => {
  for (const [name, { env, count, adds }] of Object.entries(COMBINATIONS)) {
    const flags = Object.keys(env).map((key) => `${key}=1`);
    const label = flags.length ? flags.join(" and ") : "neither opt-in flag";
    const added = adds.length ? `plus ${adds.join(", ")}` : "only";

    it(`${label}: ${count} tools, the defaults ${added}`, () => {
      const names = listings[name].map((t) => t.name);
      assert.equal(names.length, count);
      assert.deepEqual(
        names.sort(),
        [...tools.map((t) => t.name), ...adds].sort(),
      );
    });
  }
});

describe("server identity", () => {
  const { version } = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );

  it("reports its own serverInfo name and the package version", () => {
    const info = client.getServerVersion();
    assert.equal(info?.name, "yantratech-xero-mcp-server");
    assert.equal(info?.version, version);
  });

  it("sends the Xero API a user-agent that names this fork, not the upstream server", () => {
    assert.equal(
      getClientHeaders().headers["user-agent"],
      `yantratech-xero-mcp-server/${version} (+https://github.com/yantratech/mcp-connectors)`,
    );
  });
});

// The metadata and annotation checks run on allTools, so the opt-in tools are
// checked too although the default configuration does not register them.
describe("tool metadata", () => {
  it("gives every tool a non-empty description", () => {
    const offenders = allTools
      .filter(
        (t) => typeof t.description !== "string" || t.description.length === 0,
      )
      .map((t) => t.name);
    assert.deepEqual(offenders, []);
  });

  it("gives every tool an object inputSchema", () => {
    const offenders = allTools
      .filter(
        (t) =>
          typeof t.inputSchema !== "object" ||
          t.inputSchema === null ||
          t.inputSchema.type !== "object",
      )
      .map((t) => t.name);
    assert.deepEqual(offenders, []);
  });
});

describe("tool annotations", () => {
  it("marks every list_* and get_* tool read-only", () => {
    const offenders = allTools
      .filter((t) => t.name.startsWith("list_") || t.name.startsWith("get_"))
      .filter((t) => t.annotations?.readOnlyHint !== true)
      .map((t) => t.name);
    assert.deepEqual(offenders, []);
  });

  it("marks every download_* tool a destructive, non-idempotent local write", () => {
    const downloads = allTools.filter((t) => t.name.startsWith("download_"));
    assert.equal(downloads.length, 3);
    for (const t of downloads) {
      assert.deepEqual(
        {
          readOnlyHint: t.annotations?.readOnlyHint,
          destructiveHint: t.annotations?.destructiveHint,
          idempotentHint: t.annotations?.idempotentHint,
        },
        { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
        t.name,
      );
    }
  });

  it("annotates prepare_attachment as a non-destructive local write", () => {
    const tool = byName.get("prepare_attachment");
    assert.equal(tool.annotations?.readOnlyHint, false);
    assert.equal(tool.annotations?.destructiveHint, false);
    assert.equal(tool.annotations?.idempotentHint, false);
    assert.equal(tool.annotations?.openWorldHint, false);
  });

  it("gives every tool an explicit readOnlyHint", () => {
    const offenders = allTools
      .filter((t) => typeof t.annotations?.readOnlyHint !== "boolean")
      .map((t) => t.name);
    assert.deepEqual(offenders, []);
  });

  it("marks every delete_*, void_*, and archive_* tool destructive", () => {
    const offenders = allTools
      .filter(
        (t) =>
          t.name.startsWith("delete_") ||
          t.name.startsWith("void_") ||
          t.name.startsWith("archive_"),
      )
      .filter(
        (t) =>
          t.annotations?.destructiveHint !== true ||
          t.annotations?.readOnlyHint !== false,
      )
      .map((t) => t.name);
    assert.deepEqual(offenders, []);
  });

  it("never marks a tool both read-only and destructive", () => {
    const offenders = allTools
      .filter(
        (t) =>
          t.annotations?.readOnlyHint === true &&
          t.annotations?.destructiveHint === true,
      )
      .map((t) => t.name);
    assert.deepEqual(offenders, []);
  });

  it("marks create_contact and create_invoice as non-read-only writes", () => {
    for (const name of ["create_contact", "create_invoice"]) {
      const tool = byName.get(name);
      assert.equal(tool.annotations?.readOnlyHint, false, name);
      assert.equal(tool.annotations?.destructiveHint, false, name);
    }
  });
});
