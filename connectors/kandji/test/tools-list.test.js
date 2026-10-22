// MCP smoke test: spawns the built server (dist/index.js) over stdio with a
// real MCP client and verifies the tools/list surface. Fully offline — the
// server never receives a tools/call, so the dummy credentials are never used.
//
// Run: node --test test/tools-list.test.js   (requires `npm run build` first)

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER_PATH = fileURLToPath(new URL("../dist/index.js", import.meta.url));

const EXPECTED_TOOL_COUNT = 114;

// A representative sample across tool groups; the full surface is covered by
// the count + naming assertions below.
const SPOT_CHECK_NAMES = [
  "list_devices",
  "get_device",
  "erase_device",
  "prism_apps",
  "prism_count",
  "create_blueprint",
  "list_vulnerabilities",
  "get_filevault_recovery_key",
  "blank_push",
  "test_connection",
];

let client;
let tools;

before(async () => {
  client = new Client({ name: "tools-list-smoke-test", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    env: {
      // Dummy values: tools/list never touches the Kandji API.
      KANDJI_API_TOKEN: "smoke-test-dummy-token",
      KANDJI_BASE_URL: "https://example.invalid/api/v1",
      PATH: process.env.PATH ?? "",
    },
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

test("serverInfo names the package and reports the package.json version", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const info = client.getServerVersion();
  assert.equal(info?.name, "yantratech-kandji-mcp-server");
  assert.equal(info?.version, pkg.version);
});

test(`tools/list returns exactly ${EXPECTED_TOOL_COUNT} tools`, () => {
  assert.equal(tools.length, EXPECTED_TOOL_COUNT);
});

test("every tool name is snake_case ([a-z0-9_]+) and unique", () => {
  const seen = new Set();
  for (const tool of tools) {
    assert.match(
      tool.name,
      /^[a-z0-9_]+$/,
      `tool name not snake_case: ${tool.name}`,
    );
    assert.ok(!seen.has(tool.name), `duplicate tool name: ${tool.name}`);
    seen.add(tool.name);
  }
});

test("spot-check tool names are present", () => {
  const names = new Set(tools.map((t) => t.name));
  for (const expected of SPOT_CHECK_NAMES) {
    assert.ok(names.has(expected), `missing expected tool: ${expected}`);
  }
});

test("every tool has a description and an object inputSchema", () => {
  for (const tool of tools) {
    assert.equal(
      typeof tool.description,
      "string",
      `missing description: ${tool.name}`,
    );
    assert.ok(
      tool.description.length > 0,
      `empty description: ${tool.name}`,
    );
    assert.ok(tool.inputSchema, `missing inputSchema: ${tool.name}`);
    assert.equal(
      tool.inputSchema.type,
      "object",
      `inputSchema.type !== "object": ${tool.name}`,
    );
  }
});

test("every list_* tool is annotated read-only", () => {
  const listTools = tools.filter((t) => t.name.startsWith("list_"));
  assert.ok(listTools.length > 0, "expected at least one list_* tool");
  for (const tool of listTools) {
    assert.equal(
      tool.annotations?.readOnlyHint,
      true,
      `list_* tool not annotated readOnlyHint:true: ${tool.name}`,
    );
  }
});

function assertDestructive(tool, name) {
  assert.ok(tool, `missing tool: ${name}`);
  assert.equal(
    tool.annotations?.destructiveHint,
    true,
    `${name} should be annotated destructiveHint:true`,
  );
  assert.notEqual(
    tool.annotations?.readOnlyHint,
    true,
    `${name} must not be annotated read-only`,
  );
}

// Every tool whose name says it deletes, removes or erases something. Pinned
// by name so that dropping one of these tools (or its annotation) fails
// loudly instead of silently shrinking the rule-based check below.
const DESTRUCTIVE_BY_NAME = [
  "erase_device",
  "delete_user",
  "delete_blueprint",
  "delete_tag",
  "delete_device_note",
  "delete_custom_app",
  "delete_custom_profile",
  "delete_custom_script",
  "delete_in_house_app",
  "remove_library_item",
];

// Destructive tools whose names don't say so: lock_device locks the user out
// until the PIN is entered, clear_passcode strips the device passcode.
const DESTRUCTIVE_OTHER = ["lock_device", "clear_passcode"];

test("every delete_*/remove_*/erase_* tool is annotated destructive", () => {
  const matching = tools.filter((t) =>
    /^(delete|remove|erase)_/.test(t.name),
  );
  for (const tool of matching) assertDestructive(tool, tool.name);
  // Any new tool with one of these prefixes must be added to the pinned list.
  assert.deepEqual(
    matching.map((t) => t.name).sort(),
    [...DESTRUCTIVE_BY_NAME].sort(),
  );
});

test("destructive tools are annotated destructive", () => {
  const byName = new Map(tools.map((t) => [t.name, t]));
  for (const name of [...DESTRUCTIVE_BY_NAME, ...DESTRUCTIVE_OTHER]) {
    assertDestructive(byName.get(name), name);
  }
});

test("erase_device is annotated destructive and non-idempotent: each call with a PIN queues another erase", () => {
  const tool = tools.find((t) => t.name === "erase_device");
  assert.ok(tool, "missing tool: erase_device");
  assert.equal(tool.annotations?.readOnlyHint, false);
  assert.equal(tool.annotations?.destructiveHint, true);
  assert.equal(tool.annotations?.idempotentHint, false);
});

test("get_filevault_recovery_key is annotated read-only (sensitive, but a pure read)", () => {
  const tool = tools.find((t) => t.name === "get_filevault_recovery_key");
  assert.ok(tool, "missing tool: get_filevault_recovery_key");
  assert.equal(tool.annotations?.readOnlyHint, true);
  assert.notEqual(tool.annotations?.destructiveHint, true);
});
