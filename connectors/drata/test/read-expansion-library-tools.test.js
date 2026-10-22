/**
 * Offline tool-layer tests for the library/device read-expansion tools.
 *
 * test/read-expansion-library.test.js drives the dist HANDLER functions
 * directly, so the tool handler closures' param mapping (zod arg names →
 * handler params, e.g. codes → "codes[]") is unexercised there. These tests
 * import the tool factories from dist/tools/v2/library-device-reads.tools.js
 * and drive tool.handler(args) end-to-end against the same node:http mock
 * harness, pinning the wire formats the closures produce.
 *
 * Run: node --test test/read-expansion-library-tools.test.js (after npm run build)
 */
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

let server;
let baseUrl;
let requests;

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function json(res, payload, status = 200) {
  res.statusCode = status;
  res.end(JSON.stringify(payload));
}

before(async () => {
  requests = [];
  server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    requests.push({
      method: req.method,
      url: req.url,
      body,
      contentType: req.headers["content-type"],
    });

    res.setHeader("content-type", "application/json");
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;

    // V1 personnel directory (email → personnelId resolution).
    if (path === "/public/personnel") {
      json(res, {
        data: [{ id: 77, user: { id: 900, email: "jane@acme.test" } }],
        total: 1,
      });
      return;
    }

    if (path === "/public/v2/workspaces/1/controls/55") {
      json(res, { id: 55, name: "Control 55", archivedAt: null });
      return;
    }

    if (path === "/public/v2/control-library") {
      json(res, {
        data: [{ id: 5, code: "AC-1", name: "Template 5" }],
        pagination: { cursor: null },
      });
      return;
    }

    if (path === "/public/v2/personnel/77/devices") {
      json(res, {
        data: [{ id: 123, serialNumber: "C02XYZ" }],
        pagination: { cursor: null },
      });
      return;
    }

    json(res, { data: [], pagination: { cursor: null } });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  process.env.DRATA_API_KEY = "test-key";
  process.env.DRATA_BASE_URL = baseUrl;
  process.env.DRATA_WORKSPACE_ID = "1";
});

beforeEach(() => {
  requests.length = 0;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function searchParamsOf(request) {
  return new URL(request.url, "http://localhost").searchParams;
}

async function getTool(name) {
  const { LibraryDeviceReadTools } = await import(
    "../dist/tools/v2/library-device-reads.tools.js"
  );
  const factory = LibraryDeviceReadTools.find(
    (candidate) => candidate().name === name,
  );
  assert.ok(factory, `tool ${name} not found`);
  return factory();
}

describe("list_control_library tool param mapping", () => {
  it("maps codes/ids args onto bracketed codes[]/ids[] wire keys", async () => {
    const tool = await getTool("list_control_library");
    const result = await tool.handler({ codes: ["AC-1"], ids: [5] });

    assert.notEqual(result.isError, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "GET");
    assert.match(requests[0].url, /^\/public\/v2\/control-library\?/);
    const params = searchParamsOf(requests[0]);
    assert.deepEqual(params.getAll("codes[]"), ["AC-1"]);
    assert.deepEqual(params.getAll("ids[]"), ["5"]);
    assert.equal(params.has("codes"), false, "unbracketed codes must not leak");
    assert.equal(params.has("ids"), false, "unbracketed ids must not leak");
    const parsed = JSON.parse(result.content[0].text);
    assert.deepEqual(
      parsed.templates.map((t) => t.id),
      [5],
    );
  });
});

describe("get_control tool param mapping", () => {
  it("interpolates the workspace path and serializes expand", async () => {
    const tool = await getTool("get_control");
    const result = await tool.handler({
      controlId: 55,
      expand: ["requirements", "owners"],
    });

    assert.notEqual(result.isError, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "GET");
    assert.match(requests[0].url, /^\/public\/v2\/workspaces\/1\/controls\/55\?/);
    const params = searchParamsOf(requests[0]);
    assert.deepEqual(params.getAll("expand"), ["requirements", "owners"]);
    const parsed = JSON.parse(result.content[0].text);
    assert.deepEqual(parsed, { id: 55, name: "Control 55", archivedAt: null });
  });
});

describe("list_personnel_devices tool param mapping", () => {
  it("resolves lookupEmail via the V1 personnel directory before the V2 devices call", async () => {
    const tool = await getTool("list_personnel_devices");
    const result = await tool.handler({ lookupEmail: "Jane@acme.test" });

    assert.notEqual(result.isError, true);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].method, "GET");
    assert.match(requests[0].url, /^\/public\/personnel\?/);
    assert.equal(requests[1].method, "GET");
    assert.match(requests[1].url, /^\/public\/v2\/personnel\/77\/devices/);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.devices[0].id, 123);
  });

  it("rejects personnelId + lookupEmail together without calling the API", async () => {
    const tool = await getTool("list_personnel_devices");
    const result = await tool.handler({
      personnelId: 77,
      lookupEmail: "jane@acme.test",
    });

    assert.equal(result.isError, true);
    assert.match(
      result.content[0].text,
      /exactly one of: personnelId, lookupEmail/,
    );
    assert.equal(requests.length, 0, "no request may be made on arg conflict");
  });
});
