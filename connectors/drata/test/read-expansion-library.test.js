/**
 * Offline tests for the library and device read tools:
 * control get/comparison, control library, risk library, device drill-down.
 *
 * Same harness shape as test/api-coverage.test.js: a local node:http mock
 * server captures every request (method/url/query) so wire formats —
 * workspaceId interpolation, bracketed array params, expand[] serialization,
 * envelope shaping — are pinned without touching the network.
 *
 * Run: node --test test/read-expansion-library.test.js (after npm run build)
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

    if (path === "/public/v2/workspaces/1/controls-requirement-comparison") {
      json(res, { comparisons: [{ controlId: 1, drift: false }] });
      return;
    }

    if (path === "/public/v2/control-library") {
      const cursor = url.searchParams.get("cursor");
      const first = { id: 1, code: "DCF-1", name: "Template 1", noise: "x" };
      const second = { id: 2, code: "DCF-2", name: "Template 2", noise: "y" };
      if (cursor === "page2") {
        json(res, { data: [second], pagination: { cursor: null } });
      } else if (url.searchParams.has("size")) {
        json(res, { data: [first], pagination: { cursor: "next-cursor" } });
      } else {
        json(res, { data: [first], pagination: { cursor: "page2" } });
      }
      return;
    }

    if (path === "/public/v2/control-library/9") {
      json(res, { id: 9, code: "DCF-9", name: "Template 9" });
      return;
    }

    if (/^\/public\/v2\/risk-registers\/\d+\/risk-library$/.test(path)) {
      json(res, {
        data: [{ id: "RL-1", title: "Library risk", extra: "z" }],
        pagination: { cursor: null },
      });
      return;
    }

    if (path === "/public/v2/risk-registers/2/risk-library/RL-1") {
      json(res, { id: "RL-1", title: "Library risk" });
      return;
    }

    if (path === "/public/v2/devices/404") {
      json(res, { statusCode: 404, message: "Device not found", code: 10170 }, 404);
      return;
    }

    if (path === "/public/v2/devices/123") {
      json(res, { id: 123, model: "MacBook Pro", serialNumber: "C02XYZ" });
      return;
    }

    if (path === "/public/v2/devices/123/apps") {
      json(res, {
        data: [
          { name: "Chrome", version: "126.0", bundleId: "com.google.Chrome" },
          { name: "Slack", version: "4.39", bundleId: "com.tinyspeck.slackmacgap" },
        ],
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

    if (path === "/public/v2/connections/5/devices") {
      json(res, { data: [], pagination: { cursor: null } });
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
  process.env.DRATA_RISK_REGISTER_ID = "2";
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

describe("control reads (V2)", () => {
  it("get_control interpolates workspaceId and serializes expand + advanced page params", async () => {
    const { getControl } = await import(
      "../dist/handlers/library-device-reads.handler.js"
    );

    const result = await getControl(undefined, 55, {
      expand: ["requirements", "owners"],
      size: 10,
    });

    assert.equal(result.isError, false);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "GET");
    assert.match(requests[0].url, /^\/public\/v2\/workspaces\/1\/controls\/55\?/);
    const params = searchParamsOf(requests[0]);
    assert.deepEqual(params.getAll("expand"), ["requirements", "owners"]);
    assert.equal(params.get("size"), "10");
    assert.deepEqual(result.result, { id: 55, name: "Control 55", archivedAt: null });
  });

  it("get_control_requirement_comparison serializes controlIds[] as a bracketed array", async () => {
    const { getControlRequirementComparison } = await import(
      "../dist/handlers/library-device-reads.handler.js"
    );

    const result = await getControlRequirementComparison(undefined, [1, 2]);

    assert.equal(result.isError, false);
    assert.match(
      requests[0].url,
      /^\/public\/v2\/workspaces\/1\/controls-requirement-comparison\?/,
    );
    const params = searchParamsOf(requests[0]);
    assert.deepEqual(params.getAll("controlIds[]"), ["1", "2"]);
    assert.deepEqual(result.result, {
      comparisons: [{ controlId: 1, drift: false }],
    });
  });
});

describe("control library (V2)", () => {
  it("list_control_library walks every page in fetch-all mode and merges", async () => {
    const { listControlLibrary } = await import(
      "../dist/handlers/library-device-reads.handler.js"
    );

    const result = await listControlLibrary();

    assert.equal(result.isError, false);
    assert.equal(requests.length, 2);
    assert.equal(searchParamsOf(requests[1]).get("cursor"), "page2");
    assert.equal(result.result.returned, 2);
    assert.equal(result.result.total, 2);
    assert.deepEqual(
      result.result.templates.map((t) => t.id),
      [1, 2],
    );
  });

  it("list_control_library explicit page returns wrapV2List envelope with total null while a cursor is outstanding", async () => {
    const { listControlLibrary } = await import(
      "../dist/handlers/library-device-reads.handler.js"
    );

    const result = await listControlLibrary({ size: 1 });

    assert.equal(result.isError, false);
    assert.equal(requests.length, 1);
    assert.equal(searchParamsOf(requests[0]).get("size"), "1");
    assert.equal(result.result.returned, 1);
    assert.equal(result.result.total, null);
    assert.equal(result.result.pagination.cursor, "next-cursor");
    assert.ok(Array.isArray(result.result.templates));
  });

  it("list_control_library serializes codes[]/ids[]/excludeIds[] and boolean filters", async () => {
    const { listControlLibrary } = await import(
      "../dist/handlers/library-device-reads.handler.js"
    );

    await listControlLibrary({
      size: 5,
      "codes[]": ["DCF-1", "DCF-2"],
      "ids[]": ["1"],
      "excludeIds[]": ["3"],
      hasTests: true,
      frameworkTag: "SOC 2",
    });

    const params = searchParamsOf(requests[0]);
    assert.deepEqual(params.getAll("codes[]"), ["DCF-1", "DCF-2"]);
    assert.deepEqual(params.getAll("ids[]"), ["1"]);
    assert.deepEqual(params.getAll("excludeIds[]"), ["3"]);
    assert.equal(params.get("hasTests"), "true");
    assert.equal(params.get("frameworkTag"), "SOC 2");
  });

  it("list_control_library projects requested fields only", async () => {
    const { listControlLibrary } = await import(
      "../dist/handlers/library-device-reads.handler.js"
    );

    const result = await listControlLibrary(undefined, {
      fields: ["id", "code"],
    });

    assert.equal(result.isError, false);
    assert.deepEqual(result.result.templates, [
      { id: 1, code: "DCF-1" },
      { id: 2, code: "DCF-2" },
    ]);
  });

  it("get_control_library_item serializes the pinned detail expand enum", async () => {
    const { getControlLibraryItem } = await import(
      "../dist/handlers/library-device-reads.handler.js"
    );

    const result = await getControlLibraryItem(9, {
      expand: ["testTemplates", "controlsUsingTemplate"],
    });

    assert.equal(result.isError, false);
    assert.match(requests[0].url, /^\/public\/v2\/control-library\/9\?/);
    const params = searchParamsOf(requests[0]);
    assert.deepEqual(params.getAll("expand"), [
      "testTemplates",
      "controlsUsingTemplate",
    ]);
    assert.deepEqual(result.result, { id: 9, code: "DCF-9", name: "Template 9" });
  });
});

describe("risk library (V2)", () => {
  it("list_risk_library resolves the register from DRATA_RISK_REGISTER_ID", async () => {
    const { listRiskLibrary } = await import(
      "../dist/handlers/library-device-reads.handler.js"
    );

    const result = await listRiskLibrary(undefined, { title: "Library" });

    assert.equal(result.isError, false);
    assert.match(requests[0].url, /^\/public\/v2\/risk-registers\/2\/risk-library\?/);
    assert.equal(searchParamsOf(requests[0]).get("title"), "Library");
    assert.equal(result.result.returned, 1);
    assert.equal(result.result.libraryRisks[0].id, "RL-1");
  });

  it("list_risk_library prefers an explicit riskRegisterId over the env fallback", async () => {
    const { listRiskLibrary } = await import(
      "../dist/handlers/library-device-reads.handler.js"
    );

    const result = await listRiskLibrary(9);

    assert.equal(result.isError, false);
    assert.match(requests[0].url, /^\/public\/v2\/risk-registers\/9\/risk-library$/);
  });

  it("get_risk_library_item uses the string library ID in the path", async () => {
    const { getRiskLibraryItem } = await import(
      "../dist/handlers/library-device-reads.handler.js"
    );

    const result = await getRiskLibraryItem(undefined, "RL-1");

    assert.equal(result.isError, false);
    assert.equal(requests[0].url, "/public/v2/risk-registers/2/risk-library/RL-1");
    assert.deepEqual(result.result, { id: "RL-1", title: "Library risk" });
  });
});

describe("device drill-down (V2)", () => {
  it("get_device fetches a single device by ID", async () => {
    const { getDevice } = await import(
      "../dist/handlers/library-device-reads.handler.js"
    );

    const result = await getDevice(123);

    assert.equal(result.isError, false);
    assert.equal(requests[0].url, "/public/v2/devices/123");
    assert.deepEqual(result.result, {
      id: 123,
      model: "MacBook Pro",
      serialNumber: "C02XYZ",
    });
  });

  it("get_device maps an upstream 404 to isError with httpStatus", async () => {
    const { getDevice } = await import(
      "../dist/handlers/library-device-reads.handler.js"
    );

    const result = await getDevice(404);

    assert.equal(result.isError, true);
    assert.equal(result.httpStatus, 404);
    assert.equal(result.drataCode, 10170);
    assert.match(result.error, /Device not found/);
  });

  it("list_device_apps fetches all pages and projects fields", async () => {
    const { listDeviceApps } = await import(
      "../dist/handlers/library-device-reads.handler.js"
    );

    const result = await listDeviceApps(123, undefined, {
      fields: ["name", "version"],
    });

    assert.equal(result.isError, false);
    assert.match(requests[0].url, /^\/public\/v2\/devices\/123\/apps/);
    assert.deepEqual(result.result.apps, [
      { name: "Chrome", version: "126.0" },
      { name: "Slack", version: "4.39" },
    ]);
    assert.equal(result.result.returned, 2);
    assert.equal(result.result.total, 2);
  });

  it("list_personnel_devices uses personnelId directly and serializes filters", async () => {
    const { listPersonnelDevices } = await import(
      "../dist/handlers/library-device-reads.handler.js"
    );

    const result = await listPersonnelDevices(
      { personnelId: 77 },
      { serialNumber: "C02XYZ", sourceType: "AGENT" },
    );

    assert.equal(result.isError, false);
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /^\/public\/v2\/personnel\/77\/devices\?/);
    const params = searchParamsOf(requests[0]);
    assert.equal(params.get("serialNumber"), "C02XYZ");
    assert.equal(params.get("sourceType"), "AGENT");
    assert.equal(result.result.devices[0].id, 123);
  });

  it("list_personnel_devices resolves lookupEmail via the V1 personnel directory first", async () => {
    const { listPersonnelDevices } = await import(
      "../dist/handlers/library-device-reads.handler.js"
    );

    const result = await listPersonnelDevices({ lookupEmail: "Jane@acme.test" });

    assert.equal(result.isError, false);
    assert.equal(requests.length, 2);
    assert.match(requests[0].url, /^\/public\/personnel\?/);
    assert.match(requests[1].url, /^\/public\/v2\/personnel\/77\/devices/);
  });

  it("list_personnel_devices rejects zero or two targets without calling the API", async () => {
    const { listPersonnelDevices } = await import(
      "../dist/handlers/library-device-reads.handler.js"
    );

    const neither = await listPersonnelDevices({});
    assert.equal(neither.isError, true);
    assert.match(neither.error, /exactly one of: personnelId, lookupEmail/);

    const both = await listPersonnelDevices({
      personnelId: 77,
      lookupEmail: "jane@acme.test",
    });
    assert.equal(both.isError, true);
    assert.match(both.error, /exactly one of: personnelId, lookupEmail/);

    assert.equal(requests.length, 0);
  });

  it("list_connection_devices hits the connection-scoped path with filters", async () => {
    const { listConnectionDevices } = await import(
      "../dist/handlers/library-device-reads.handler.js"
    );

    const result = await listConnectionDevices(5, { personnelId: 77 });

    assert.equal(result.isError, false);
    assert.match(requests[0].url, /^\/public\/v2\/connections\/5\/devices\?/);
    assert.equal(searchParamsOf(requests[0]).get("personnelId"), "77");
    assert.deepEqual(result.result.devices, []);
  });
});

describe("tool registration", () => {
  it("exposes all ten read-expansion tools with read-only annotations", async () => {
    const { LibraryDeviceReadTools } = await import(
      "../dist/tools/v2/library-device-reads.tools.js"
    );

    const tools = LibraryDeviceReadTools.map((factory) => factory());
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [
        "get_control",
        "get_control_requirement_comparison",
        "list_control_library",
        "get_control_library_item",
        "list_risk_library",
        "get_risk_library_item",
        "get_device",
        "list_device_apps",
        "list_personnel_devices",
        "list_connection_devices",
      ],
    );
    for (const tool of tools) {
      assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
      assert.equal(tool.annotations?.idempotentHint, true, tool.name);
    }
    const beta = tools.find((tool) => tool.name === "list_connection_devices");
    assert.match(beta.description, /🧪 beta — may change/);
  });
});
