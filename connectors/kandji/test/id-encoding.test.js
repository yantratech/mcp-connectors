/**
 * Regression tests for ID path-segment encoding. Caller-supplied IDs are
 * interpolated into request paths; if `/` and `..` survived, then
 *
 *   get_device("abc/secrets/filevaultkey")  → GET    /devices/abc/secrets/filevaultkey
 *     (a read-only tool returning the FileVault key with no audit line)
 *   delete_tag("../blueprints/X")           → DELETE /blueprints/X
 *     (deleting a blueprint through the tag tool)
 *
 * The mock Kandji API below records every request it receives. Each attack
 * must be refused BEFORE any request is sent, both at the MCP schema layer
 * and — for callers that bypass the schema — inside the client itself.
 *
 * Fully offline. Run: node --test test/id-encoding.test.js
 * (requires `npm run build` first)
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const VALID_UUID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

// Both traversal attacks above, plus encoded / alternate-separator variants.
const DEVICE_ATTACKS = [
  "abc/secrets/filevaultkey",
  "abc%2fsecrets%2ffilevaultkey",
  "abc%2Fsecrets%2Ffilevaultkey",
  "abc%252fsecrets%252ffilevaultkey",
  "abc\\secrets\\filevaultkey",
  "abc%5csecrets%5cfilevaultkey",
  "abc?x=/secrets/filevaultkey",
  "abc#/secrets/filevaultkey",
];
const TAG_ATTACKS = [
  "../blueprints/X",
  "..",
  ".",
  "..%2fblueprints%2fX",
  "%2e%2e/blueprints/X",
  "%2E%2E%2Fblueprints%2FX",
  "%2e%2e",
  "..\\blueprints\\X",
  "..%5cblueprints%5cX",
  "%252e%252e%252fblueprints%252fX",
];
const OTHER_BAD_IDS = ["", "abc\u0000", "abc\n", "abc\u007f", " abc", "1\uD800"];

const requests = [];
let server;

before(async () => {
  server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ filevault_recovery_key: "LEAKED-SECRET" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  process.env.KANDJI_API_TOKEN = "test-token";
  process.env.KANDJI_BASE_URL = `http://127.0.0.1:${port}/api/v1`;
  process.env.KANDJI_ALLOW_INSECURE = "1";
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  requests.length = 0;
});

async function connectClient() {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } =
    await import("@modelcontextprotocol/sdk/inMemory.js");
  const { ToolFactory } = await import("../dist/tools/tool-factory.js");
  const mcpServer = new McpServer({ name: "id-encoding", version: "0.0.0" });
  ToolFactory(mcpServer);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "id-encoding-client", version: "0.0.0" });
  await Promise.all([client.connect(ct), mcpServer.connect(st)]);
  return { client, mcpServer };
}

const callTool = (client, name, args) =>
  client
    .callTool({ name, arguments: args })
    .catch((err) => ({
      isError: true,
      content: [{ type: "text", text: err.message }],
    }));

const textOf = (res) => res.content?.map((c) => c.text ?? "").join("\n") ?? "";

// ── MCP layer: the two attacks above and their variants ────────────

describe("ID path traversal via the MCP tool layer", () => {
  let client;
  let mcpServer;

  before(async () => {
    ({ client, mcpServer } = await connectClient());
  });
  after(async () => {
    await client?.close();
    await mcpServer?.close();
  });

  for (const id of DEVICE_ATTACKS) {
    it(`get_device(${JSON.stringify(id)}) is rejected and never reaches /secrets`, async () => {
      const res = await callTool(client, "get_device", { device_id: id });
      assert.equal(res.isError, true, textOf(res));
      assert.doesNotMatch(textOf(res), /LEAKED-SECRET/);
      assert.deepEqual(
        requests,
        [],
        "no request may be sent for a rejected ID",
      );
    });
  }

  for (const id of TAG_ATTACKS) {
    it(`delete_tag(${JSON.stringify(id)}) is rejected and never reaches /blueprints`, async () => {
      const res = await callTool(client, "delete_tag", { tag_id: id });
      assert.equal(res.isError, true, textOf(res));
      assert.deepEqual(
        requests,
        [],
        "no request may be sent for a rejected ID",
      );
    });
  }

  for (const id of OTHER_BAD_IDS) {
    it(`get_user(${JSON.stringify(id)}) is rejected`, async () => {
      const res = await callTool(client, "get_user", { user_id: id });
      assert.equal(res.isError, true, textOf(res));
      assert.deepEqual(requests, []);
    });
  }

  it("a well-formed UUID still reaches the right path", async () => {
    const res = await callTool(client, "get_device", { device_id: VALID_UUID });
    assert.notEqual(res.isError, true, textOf(res));
    assert.deepEqual(requests, [
      { method: "GET", url: `/api/v1/devices/${VALID_UUID}` },
    ]);
  });

  it("UUIDs without RFC version/variant bits, and upper-case UUIDs, are accepted", async () => {
    // Kandji's own docs show IDs like this one, whose variant nibble is not
    // RFC 4122/9562-compliant; a strict z.uuid() would reject them.
    const loose = "b5d21f9e-9999-4444-3333-c292b3c2ccad";
    let res = await callTool(client, "get_custom_app", { library_item_id: loose });
    assert.notEqual(res.isError, true, textOf(res));
    res = await callTool(client, "get_device", { device_id: VALID_UUID.toUpperCase() });
    assert.notEqual(res.isError, true, textOf(res));
    assert.equal(requests.length, 2);
  });

  it('optional filters still accept "" as "no filter" but reject traversal', async () => {
    let res = await callTool(client, "list_devices", { blueprint_id: "" });
    assert.notEqual(res.isError, true, textOf(res));
    assert.equal(requests.length, 1);
    assert.doesNotMatch(requests[0].url, /blueprint_id/);
    requests.length = 0;
    res = await callTool(client, "list_devices", { blueprint_id: "../x" });
    assert.equal(res.isError, true);
    assert.deepEqual(requests, []);
  });

  it("a non-UUID device_id is rejected at the schema", async () => {
    const res = await callTool(client, "get_device", { device_id: "dev-1" });
    assert.equal(res.isError, true);
    assert.match(textOf(res), /expected a UUID/);
    assert.deepEqual(requests, []);
  });

  it("non-UUID IDs the API accepts (legacy integer user, CVE) still work", async () => {
    let res = await callTool(client, "get_user", { user_id: "12345" });
    assert.notEqual(res.isError, true, textOf(res));
    res = await callTool(client, "get_vulnerability", {
      cve_id: "CVE-2024-23201",
    });
    assert.notEqual(res.isError, true, textOf(res));
    assert.deepEqual(
      requests.map((r) => r.url),
      [
        "/api/v1/users/12345",
        "/api/v1/vulnerability-management/vulnerabilities/CVE-2024-23201",
      ],
    );
  });
});

// ── Client layer: defence in depth for callers that skip the schema ──

describe("ID path traversal via handlers (schema bypassed)", () => {
  it("getDevice handler refuses a path-bearing ID without sending a request", async () => {
    const { getDevice } =
      await import("../dist/handlers/get-device.handler.js");
    for (const id of DEVICE_ATTACKS) {
      const out = await getDevice(id);
      assert.equal(
        out.isError,
        true,
        `getDevice(${JSON.stringify(id)}) must fail`,
      );
    }
    assert.deepEqual(requests, []);
  });

  it("deleteTag handler refuses a traversal ID without sending a request", async () => {
    const { deleteTag } =
      await import("../dist/handlers/tags-write.handler.js");
    for (const id of TAG_ATTACKS) {
      const out = await deleteTag(id);
      assert.equal(
        out.isError,
        true,
        `deleteTag(${JSON.stringify(id)}) must fail`,
      );
    }
    assert.deepEqual(requests, []);
  });

  it("getDeviceSecret writes no audit line and sends nothing for a bad ID", async () => {
    const { getDeviceSecret } =
      await import("../dist/handlers/get-device-secret.handler.js");
    const written = [];
    const realWrite = process.stderr.write;
    process.stderr.write = (chunk, ...rest) => {
      written.push(String(chunk));
      return realWrite.call(process.stderr, chunk, ...rest);
    };
    let out;
    try {
      out = await getDeviceSecret("../../blueprints", "filevaultkey");
    } finally {
      process.stderr.write = realWrite;
    }
    assert.equal(out.isError, true);
    assert.deepEqual(requests, []);
    assert.equal(
      written.filter((l) => l.includes("device secret accessed")).length,
      0,
      "a refused secret read must not log a successful access",
    );
  });
});

// ── encodeId unit behaviour ─────────────────────────────────────

describe("encodeId", () => {
  it("rejects every attack variant and percent-encodes safe IDs", async () => {
    const { encodeId, InvalidKandjiIdError } =
      await import("../dist/helpers/kandji-id.js");
    for (const id of [...DEVICE_ATTACKS, ...TAG_ATTACKS, ...OTHER_BAD_IDS]) {
      assert.throws(
        () => encodeId(id),
        InvalidKandjiIdError,
        JSON.stringify(id),
      );
    }
    assert.equal(encodeId(VALID_UUID), VALID_UUID);
    assert.equal(encodeId("CVE-2024-23201"), "CVE-2024-23201");
    assert.equal(encodeId("a b+c&d"), "a%20b%2Bc%26d");
    // Three or more dots are an ordinary segment, not a dot segment.
    assert.equal(encodeId("..."), "...");
  });
});

// ── Sweep: every tool that takes an ID rejects ".." ─────────────

describe("every ID-taking tool rejects '..'", () => {
  let client;
  let mcpServer;
  let tools;

  before(async () => {
    ({ client, mcpServer } = await connectClient());
    tools = (await client.listTools()).tools;
  });
  after(async () => {
    await client?.close();
    await mcpServer?.close();
  });

  const ID_KEY = /(^|_)ids?$/;

  it("covers every *_id / *_ids parameter and refuses '..' before any request", async () => {
    const { INVALID_ID_MESSAGE } = await import("../dist/helpers/kandji-id.js");
    const checked = [];
    for (const tool of tools) {
      const props = tool.inputSchema?.properties ?? {};
      for (const [key, schema] of Object.entries(props)) {
        if (!ID_KEY.test(key)) continue;
        const isArray =
          schema.type === "array" ||
          (Array.isArray(schema.anyOf) &&
            schema.anyOf.some((s) => s.type === "array"));
        const value = isArray ? [".."] : "..";
        const res = await callTool(client, tool.name, { [key]: value });
        const text = textOf(res);
        assert.equal(
          res.isError,
          true,
          `${tool.name}.${key}: '..' must be rejected`,
        );
        assert.ok(
          text.includes(INVALID_ID_MESSAGE),
          `${tool.name}.${key}: expected the ID guard's message, got: ${text.slice(0, 300)}`,
        );
        checked.push(`${tool.name}.${key}`);
      }
    }
    assert.deepEqual(requests, [], "no request may be sent for a rejected ID");
    // Guard against a vacuous sweep (e.g. schemas stop being advertised).
    assert.ok(
      checked.length >= 60,
      `only ${checked.length} ID parameters swept`,
    );
    for (const must of [
      "get_device.device_id",
      "delete_tag.tag_id",
      "get_user.user_id",
    ]) {
      assert.ok(checked.includes(must), `sweep missed ${must}`);
    }
  });
});
