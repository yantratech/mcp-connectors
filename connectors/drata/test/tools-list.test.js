/**
 * MCP smoke test: spawn the compiled server (dist/index.js) over stdio and
 * exercise tools/list end-to-end through the real MCP protocol.
 *
 * Fully offline — only dummy credentials are passed to the child process and
 * DRATA_BASE_URL points at an unroutable local port, so any accidental API
 * call would fail fast instead of leaking to the network. tools/list itself
 * never touches the Drata API.
 *
 * Run: node --test test/tools-list.test.js
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST_ENTRY = path.join(HERE, "..", "dist", "index.js");

/** Total number of tools the server is expected to register. */
const EXPECTED_TOOL_COUNT = 140;

/** Tool names must be snake_case: lowercase alphanumerics and underscores. */
const NAME_PATTERN = /^[a-z0-9_]+$/;

/**
 * Spot-check sample spanning every tool family (check/, get/, list/, write/,
 * v2/, github/). Each name is verified against its src/tools definition —
 * if one of these fails, a rename slipped through without updating the
 * public tool surface.
 */
const SPOT_CHECK_NAMES = [
  "run_gap_analysis",
  "list_controls",
  "create_vendor",
  "get_monitoring_test",
  "scan_github_repos",
  "fulfil_templated_evidence",
  "list_evidence_library",
  "modify_control_owners",
  "upload_user_document",
  "get_compliance_summary",
];

/** Prefixes whose tools must carry readOnlyHint: true. */
const READ_ONLY_PREFIXES = ["list_", "get_", "check_", "scan_"];

let client;
let tools;

before(async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [DIST_ENTRY],
    env: {
      // PATH is kept so the child can resolve anything node needs at startup.
      PATH: process.env.PATH ?? "",
      // Dummy credentials: the server only validates presence, never the value.
      DRATA_API_KEY: "dummy",
      GITHUB_PAT: "dummy",
      // Unroutable address — guarantees the test cannot reach the live API.
      DRATA_BASE_URL: "http://127.0.0.1:1",
    },
  });

  client = new Client({ name: "drata-tools-list-smoke", version: "1.0.0" }, {});
  await client.connect(transport);

  // Paginate tools/list until the server stops returning a nextCursor.
  tools = [];
  let cursor;
  do {
    const page = await client.listTools(cursor ? { cursor } : {});
    assert.ok(Array.isArray(page.tools), "tools/list page is missing `tools`");
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
});

after(async () => {
  await client?.close();
});

describe("tools/list over stdio", () => {
  it(`registers exactly ${EXPECTED_TOOL_COUNT} tools`, () => {
    assert.equal(
      tools.length,
      EXPECTED_TOOL_COUNT,
      `expected ${EXPECTED_TOOL_COUNT} tools, got ${tools.length} — ` +
        "update EXPECTED_TOOL_COUNT only when tools are deliberately added/removed",
    );
  });

  it("serverInfo names the package and reports the package.json version", () => {
    const pkg = JSON.parse(readFileSync(path.join(HERE, "..", "package.json"), "utf8"));
    const info = client.getServerVersion();
    assert.equal(info?.name, "yantratech-drata-mcp-server");
    assert.equal(info?.version, pkg.version);
  });

  it("every tool name is snake_case", () => {
    const bad = tools.filter((t) => !NAME_PATTERN.test(t.name));
    assert.deepEqual(
      bad.map((t) => t.name),
      [],
      "tool names must match ^[a-z0-9_]+$ (no kebab-case, no uppercase)",
    );
  });

  it("does not register the defunct get_control_evidence_download_url", () => {
    // It called GET /public/controls/{id}/evidence/download, which does not
    // exist. Drata's bulk route is workspace-scoped and not wrapped here;
    // list_external_evidence + get_external_evidence_download_url cover
    // external evidence.
    const names = tools.map((t) => t.name);
    assert.equal(names.includes("get_control_evidence_download_url"), false);
    assert.ok(names.includes("list_external_evidence"));
    assert.ok(names.includes("get_external_evidence_download_url"));
  });

  it("tool names are unique", () => {
    const names = tools.map((t) => t.name);
    const seen = new Set();
    const dupes = names.filter((n) => (seen.has(n) ? true : (seen.add(n), false)));
    assert.deepEqual(dupes, [], "duplicate tool names registered");
  });

  it("spot-check: well-known tools are discoverable under their snake_case names", () => {
    const names = new Set(tools.map((t) => t.name));
    const missing = SPOT_CHECK_NAMES.filter((n) => !names.has(n));
    assert.deepEqual(missing, [], "expected tools missing from tools/list");
  });

  it("every tool has a non-empty description", () => {
    const bad = tools
      .filter((t) => typeof t.description !== "string" || t.description.trim() === "")
      .map((t) => t.name);
    assert.deepEqual(bad, []);
  });

  it("every tool has an object inputSchema", () => {
    const bad = tools
      .filter((t) => !t.inputSchema || t.inputSchema.type !== "object")
      .map((t) => t.name);
    assert.deepEqual(bad, []);
  });

  it("every list_*/get_*/check_*/scan_* tool is annotated read-only", () => {
    const offenders = tools
      .filter((t) => READ_ONLY_PREFIXES.some((p) => t.name.startsWith(p)))
      .filter((t) => t.annotations?.readOnlyHint !== true)
      .map((t) => t.name);
    assert.deepEqual(
      offenders,
      [],
      "read-prefixed tools must carry annotations.readOnlyHint === true",
    );
  });

  it("every delete_* tool is annotated destructive (and not read-only)", () => {
    const deleteTools = tools.filter((t) => t.name.startsWith("delete_"));
    assert.ok(deleteTools.length > 0, "expected at least one delete_* tool");
    const offenders = deleteTools
      .filter(
        (t) =>
          t.annotations?.destructiveHint !== true ||
          t.annotations?.readOnlyHint === true,
      )
      .map((t) => t.name);
    assert.deepEqual(
      offenders,
      [],
      "delete_* tools must carry destructiveHint === true and must not be read-only",
    );
  });

  it("no read-only tool is simultaneously marked destructive", () => {
    const offenders = tools
      .filter(
        (t) =>
          t.annotations?.readOnlyHint === true &&
          t.annotations?.destructiveHint === true,
      )
      .map((t) => t.name);
    assert.deepEqual(offenders, []);
  });
});
