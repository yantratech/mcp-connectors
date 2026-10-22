import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// Regression tests for plan-entitlement detection, the documents-list expand
// guard, the policy-version Accept header, pagination and projection,
// monitoring testId resolution, and the GitHub setup hint. Uses its own mock
// Drata API so it can simulate plan-gated 402s, the documents-expand 500,
// content negotiation, and monitoring testId resolution.

let server;
let baseUrl;
let reqs;

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

// Mapped-control fixture for the readiness rollup: requirements 1..8 each
// have ONE live control (odd → ready, even → not ready); requirement 9 has a
// live+ready control plus an ARCHIVED not-ready one (archived must be
// ignored, so req 9 is still ready); requirement 10 has ONLY archived
// controls (out of scope). Derived: 10 total, 9 in scope, 1 out of scope,
// 5 ready (reqs 1, 3, 5, 7, 9), 4 not ready.
function requirementControls(i) {
  if (i <= 8) {
    return [{ id: 100 + i, code: `DCF-${i}`, isReady: i % 2 === 1, archivedAt: null }];
  }
  if (i === 9) {
    return [
      { id: 109, code: "DCF-9", isReady: true, archivedAt: null },
      { id: 209, code: "DCF-9A", isReady: false, archivedAt: "2026-01-01T00:00:00.000Z" },
    ];
  }
  return [
    { id: 210, code: "DCF-10A", isReady: false, archivedAt: "2026-01-01T00:00:00.000Z" },
    { id: 211, code: "DCF-10B", isReady: true, archivedAt: "2026-02-01T00:00:00.000Z" },
  ];
}

function makeDevice(i) {
  return {
    id: i,
    name: `Device ${i}`,
    personnelId: i,
    lastCheckedAt: "2026-06-20T00:00:00.000Z",
    encryptionEnabled: true,
    firewallEnabled: true,
    antivirusEnabled: true,
    autoUpdateEnabled: true,
    passwordManagerEnabled: true,
    screenLockTime: 300,
    osVersion: "15.0",
    model: "MacBookPro",
    serialNumber: `SN-${i}`,
    rawTelemetry: { blob: "x".repeat(2000) },
  };
}

before(async () => {
  reqs = [];
  server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;
    reqs.push({
      method: req.method,
      url: req.url,
      path,
      query: url.search,
      accept: req.headers["accept"],
      body,
    });
    const has = (k) => url.searchParams.has(k);
    const sizeParam = url.searchParams.get("size");

    // ── Plan-gated 402s ──
    if (path === "/public/v2/risk-registers") {
      return json(
        res,
        { statusCode: 402, message: "You must upgrade your plan to use this feature.", code: 10740 },
        402,
      );
    }
    if (path === "/public/v2/custom-connections") {
      return json(res, { statusCode: 402, message: "Upgrade required.", code: 10740 }, 402);
    }
    // Multipart risk-document upload (submitForm path) — plan-gated 402.
    if (/^\/public\/v2\/risk-registers\/\d+\/risks\/[^/]+\/documents$/.test(path)) {
      return json(
        res,
        { statusCode: 402, message: "You must upgrade your plan to use this feature.", code: 10740 },
        402,
      );
    }

    // ── Policy version content negotiation ──
    if (path === "/public/v2/policies/15/policy-versions/35") {
      const accept = String(req.headers["accept"] ?? "");
      if (accept.includes("application/json")) {
        return json(res, { id: 35, policyId: 15, status: "ACTIVE" });
      }
      if (accept.includes("text/html")) {
        res.statusCode = 200;
        res.setHeader("content-type", "text/html");
        return res.end("<p>policy</p>");
      }
      return json(res, { statusCode: 406, message: "Not Acceptable", code: 10000 }, 406);
    }

    // ── get_task numeric message-code ──
    if (path === "/public/v2/workspaces/1/tasks/1") {
      return json(res, { statusCode: 404, message: 15005, code: 10000 }, 404);
    }

    // ── Monitoring tests + failures ──
    // Deliberate COLLISION: 36 is BOTH the workspace testId of monitor 206
    // ("Has a SDLC Policy") AND the internal monitor id of "Colliding Test"
    // (whose own testId is 63).
    if (path === "/public/v2/workspaces/1/monitoring-tests") {
      return json(res, {
        data: [
          { id: 206, testId: 36, name: "Has a SDLC Policy", checkResultStatus: "PASSED" },
          { id: 205, testId: 8, name: "Formal Code Review", checkResultStatus: "PASSED" },
          { id: 36, testId: 63, name: "Colliding Test", checkResultStatus: "FAILED" },
        ],
        pagination: { cursor: null },
      });
    }
    {
      const m = path.match(/^\/public\/v2\/workspaces\/1\/monitoring-tests\/(\d+)\/failures$/);
      if (m) {
        const id = Number(m[1]);
        if (id === 36 || id === 8 || id === 63) {
          return json(res, { data: [{ id: 1, failed: true }], pagination: { cursor: null } });
        }
        return json(res, { statusCode: 404, message: "not found", code: 10170 }, 404);
      }
    }
    {
      const m = path.match(/^\/public\/v2\/workspaces\/1\/monitoring-tests\/(\d+)$/);
      if (m) {
        const id = Number(m[1]);
        if (id === 36) return json(res, { id: 206, testId: 36, name: "Has a SDLC Policy" });
        if (id === 8) return json(res, { id: 205, testId: 8, name: "Formal Code Review" });
        if (id === 63) return json(res, { id: 36, testId: 63, name: "Colliding Test" });
        return json(res, { statusCode: 404, message: "not found", code: 10170 }, 404);
      }
    }

    // ── Device documents ──
    if (path === "/public/v2/devices/16/documents") {
      if (has("expand")) {
        return json(
          res,
          { statusCode: 500, message: "An Internal Server Error has occurred", code: 10010 },
          500,
        );
      }
      return json(res, { documents: [{ id: 1, type: "ANTIVIRUS_EVIDENCE" }], pagination: { cursor: null } });
    }
    if (path === "/public/v2/devices/99/documents") {
      return json(
        res,
        { statusCode: 500, message: "An Internal Server Error has occurred", code: 10010 },
        500,
      );
    }

    // ── Devices (60 > INLINE_DEVICE_LIMIT, to exercise the cap) ──
    if (path === "/public/v2/devices") {
      const all = Array.from({ length: 60 }, (_, i) => makeDevice(i + 1));
      const size = sizeParam !== null ? Number(sizeParam) : all.length;
      const slice = all.slice(0, size);
      return json(res, {
        data: slice,
        pagination: { cursor: slice.length < all.length ? `c-${slice.length}` : null },
      });
    }

    // ── Framework requirements with expanded controls (V2) ──
    if (path === "/public/v2/workspaces/1/frameworks") {
      return json(res, {
        data: [
          {
            id: 1,
            tag: "SOC_2",
            slug: "soc2",
            isReady: false,
            numInScopeControls: 9,
            numInScopeRequirements: 9,
            numReadyInScopeRequirements: 5,
          },
        ],
        pagination: { cursor: null },
      });
    }
    if (path === "/public/v2/workspaces/1/framework-requirements") {
      const all = Array.from({ length: 10 }, (_, idx) => {
        const i = idx + 1;
        const requirement = {
          id: i,
          name: `Req ${i}`,
          code: `R-${i}`,
          frameworkId: 1,
          frameworkName: "SOC 2",
          frameworkTag: "SOC_2",
          frameworkSlug: "soc2",
        };
        if (has("expand")) {
          const controls = requirementControls(i);
          requirement.controls = { data: controls, totalCount: controls.length };
        }
        return requirement;
      });
      const size = sizeParam !== null ? Number(sizeParam) : all.length;
      const cursorParam = url.searchParams.get("cursor");
      const start = cursorParam ? Number(cursorParam.slice(2)) : 0;
      const slice = all.slice(start, start + size);
      const end = start + slice.length;
      return json(res, {
        data: slice,
        pagination: { cursor: end < all.length ? `c-${end}` : null },
      });
    }
    // V2 controls list — the union of every control mapped above, each
    // carrying its reverse `requirements` expand (the rollup builds the
    // requirement→controls mapping from this side, since the requirement-side
    // expand=controls is capped at 10 inline controls upstream).
    if (path === "/public/v2/workspaces/1/controls") {
      const controls = Array.from({ length: 10 }, (_, idx) =>
        requirementControls(idx + 1).map((c) => ({ ...c, requirementId: idx + 1 })),
      ).flat();
      return json(res, {
        data: controls.map((c) => ({
          id: c.id,
          code: c.code,
          name: `Control ${c.code}`,
          archivedAt: c.archivedAt,
          requirements: { data: [{ id: c.requirementId }], totalCount: 1 },
          flags: {
            isReady: c.isReady,
            isMonitored: false,
            hasEvidence: false,
            hasOwner: true,
            hasPolicy: false,
          },
          evidenceIds: {
            validExternalEvidenceIds: [],
            invalidExternalEvidenceIds: [],
            validReportIds: [],
            invalidReportIds: [],
          },
          testIds: { passing: [], failing: [], monitored: [] },
          frameworkTags: ["SOC_2"],
        })),
        pagination: { cursor: null },
      });
    }

    // ── Monitors (V1) for check_monitors ──
    if (path === "/public/monitors") {
      const data = [
        { id: 40, name: "Backup alerts", checkResultStatus: "ERROR", checkStatus: "ENABLED", priority: "NORMAL", monitorInstances: [] },
        { id: 138, name: "Password manager", checkResultStatus: "FAILED", checkStatus: "ENABLED", priority: "HIGH", monitorInstances: [] },
        { id: 1, name: "MFA", checkResultStatus: "PASSED", checkStatus: "ENABLED", priority: "HIGH", monitorInstances: [] },
        { id: 9, name: "Old disabled", checkResultStatus: "PASSED", checkStatus: "DISABLED", priority: "LOW", monitorInstances: [] },
      ];
      return json(res, { data, page: 1, limit: 50, total: data.length });
    }

    // ── Connections (for GitHub org discovery) ──
    if (path === "/public/connections") {
      return json(res, {
        data: [
          { id: 4, clientType: "GITHUB", clientId: "example-org", isHealthy: true },
          { id: 1, clientType: "AWS", clientId: "123", isHealthy: true },
        ],
        page: 1,
        limit: 50,
        total: 2,
      });
    }

    return json(res, { data: [], pagination: { cursor: null }, ok: true });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  process.env.DRATA_API_KEY = "test-key";
  process.env.DRATA_BASE_URL = baseUrl;
  process.env.DRATA_WORKSPACE_ID = "1";
  process.env.DRATA_RISK_REGISTER_ID = "1";
});

beforeEach(() => {
  reqs.length = 0;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// ──────────────────────────────────────────────────────────────
// Entitlements
// ──────────────────────────────────────────────────────────────
describe("entitlement detection + flagging", () => {
  // Runs first so the client's lastSeenRiskRegisterId cache is still pristine.
  it("breaks the riskRegisterId deadlock: env default, then cached usage", async () => {
    const { getDrataClient } = await import("../dist/clients/drata-client.js");
    const client = getDrataClient();
    delete process.env.DRATA_RISK_REGISTER_ID;
    // Message no longer name-drops a specific plan tier ("Risk Management
    // Pro") — it now explains list_risk_registers may be plan-gated and how
    // to break the deadlock (explicit id or DRATA_RISK_REGISTER_ID).
    assert.throws(
      () => client.resolveRiskRegisterId(),
      /DRATA_RISK_REGISTER_ID/,
    );
    assert.equal(client.resolveRiskRegisterId(7), 7);
    assert.equal(client.resolveRiskRegisterId(), 7);
    process.env.DRATA_RISK_REGISTER_ID = "1";
  });

  it("groups the six plan-gated read tools (snake_case) and exposes markers", async () => {
    const ent = await import("../dist/helpers/entitlements.js");
    for (const name of ["list_risk_registers", "get_risk_insights", "list_risk_documents"]) {
      assert.equal(ent.groupForTool(name)?.id, "risk-management-pro", name);
    }
    for (const name of [
      "list_custom_connections",
      "list_custom_data_records",
      "list_custom_data_records_sessions",
    ]) {
      assert.equal(ent.groupForTool(name)?.id, "custom-connections", name);
    }
    for (const name of ["list_risks", "get_risk", "list_risk_notes"]) {
      assert.equal(ent.groupForTool(name), undefined, name);
    }
    const group = ent.groupForTool("list_risk_registers");
    assert.match(ent.unavailableMarker(group), /UNAVAILABLE ON THIS PLAN/);
    assert.match(ent.unavailableMarker(group), /Risk Management Pro/);
  });

  it("detectUnentitledGroups marks only groups whose probe 402s", async () => {
    const { detectUnentitledGroups } = await import("../dist/helpers/entitlements.js");
    const result = await detectUnentitledGroups({
      probeHttpStatus: async (p) => (p.includes("risk-registers") ? 402 : 200),
    });
    assert.equal(result.has("risk-management-pro"), true);
    assert.equal(result.has("custom-connections"), false);
  });

  it("detection fails open on network errors", async () => {
    const { detectUnentitledGroups } = await import("../dist/helpers/entitlements.js");
    const result = await detectUnentitledGroups({ probeHttpStatus: async () => null });
    assert.equal(result.size, 0);
  });

  it("client.probeHttpStatus returns the upstream status (402 here)", async () => {
    const { getDrataClient } = await import("../dist/clients/drata-client.js");
    const status = await getDrataClient().probeHttpStatus("/public/v2/risk-registers?size=1");
    assert.equal(status, 402);
  });

  it("ToolFactory hides unentitled tools when hideUnentitled is set", async () => {
    const { ToolFactory } = await import("../dist/tools/tool-factory.js");
    const registered = [];
    const fakeServer = { tool: (name) => registered.push(name) };
    ToolFactory(fakeServer, {
      unentitledGroups: new Set(["risk-management-pro"]),
      hideUnentitled: true,
    });
    assert.ok(!registered.includes("list_risk_registers"), "should be hidden");
    assert.ok(registered.includes("list_risks"), "base-tier tool stays");
  });

  it("ToolFactory flags (keeps) unentitled tools by default", async () => {
    const { ToolFactory } = await import("../dist/tools/tool-factory.js");
    const descByName = {};
    const fakeServer = {
      tool: (name, description) => {
        descByName[name] = description;
      },
    };
    ToolFactory(fakeServer, { unentitledGroups: new Set(["risk-management-pro"]) });
    assert.ok(descByName["list_risk_registers"], "still registered");
    assert.match(descByName["list_risk_registers"], /UNAVAILABLE ON THIS PLAN/);
  });

  it("maps a 402 to a non-retryable, feature-named message from the body", async () => {
    const { listRiskRegisters } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listRiskRegisters();
    assert.equal(res.isError, true);
    assert.equal(res.httpStatus, 402);
    assert.equal(res.retryable, false);
    assert.equal(res.feature, "Risk Management Pro");
    assert.match(res.error, /You must upgrade your plan to use this feature/);
    assert.match(res.error, /list_risks/);
  });

  it("attributes the feature on a 402 from a multipart (submitForm) upload", async () => {
    const { uploadRiskDocument } = await import("../dist/handlers/v2-write.handler.js");
    const res = await uploadRiskDocument(1, "RISK-1", new Uint8Array([1, 2, 3]), "r.pdf");
    assert.equal(res.isError, true);
    assert.equal(res.httpStatus, 402);
    assert.equal(res.retryable, false);
    assert.equal(res.feature, "Risk Management Pro");
    assert.match(res.error, /list_risks/);
    assert.match(res.error, /You must upgrade your plan/);
  });
});

// ──────────────────────────────────────────────────────────────
// Document expand
// ──────────────────────────────────────────────────────────────
describe("documents-list expand", () => {
  it("strips expand before listing and still returns 200", async () => {
    const { listEntityDocuments } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listEntityDocuments("devices", 16, { expand: ["downloadUrl"], size: 5 });
    assert.equal(res.isError, false, res.error);
    const req = reqs.find((r) => r.path === "/public/v2/devices/16/documents");
    assert.ok(req, "hit the documents endpoint");
    assert.ok(!req.query.includes("expand"), `expand must be stripped: ${req.query}`);
  });

  it("reframes an upstream 500 as a clear non-5xx error", async () => {
    const { listEntityDocuments } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listEntityDocuments("devices", 99, {});
    assert.equal(res.isError, true);
    assert.equal(res.httpStatus, 422);
    assert.equal(res.retryable, false);
    assert.match(res.error, /does not support `expand`/);
  });

  it("list document tools no longer advertise expand", async () => {
    const { OperationalCoverageTools } = await import(
      "../dist/tools/v2/operational-coverage.tools.js"
    );
    for (const name of ["list_device_documents", "list_vendor_documents_v2", "list_user_documents_v2"]) {
      const tool = OperationalCoverageTools.find((f) => f().name === name)();
      assert.equal(tool.schema.expand, undefined, `${name} should not expose expand`);
    }
  });
});

// ──────────────────────────────────────────────────────────────
// Policy version metadata
// ──────────────────────────────────────────────────────────────
describe("policy-version metadata Accept header", () => {
  it("requests application/json and gets metadata (no 406)", async () => {
    const { getPolicyVersion } = await import("../dist/handlers/v2-write.handler.js");
    const res = await getPolicyVersion(15, 35);
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.id, 35);
    const req = reqs.find((r) => r.path === "/public/v2/policies/15/policy-versions/35");
    assert.match(req.accept, /application\/json/);
  });

  it("content variant still negotiates text/html", async () => {
    const { getPolicyVersionContent } = await import("../dist/handlers/v2-write.handler.js");
    const res = await getPolicyVersionContent(15, 35);
    assert.equal(res.isError, false, res.error);
    assert.match(res.result.html, /policy/);
  });
});

// ──────────────────────────────────────────────────────────────
// Pagination / fields
// ──────────────────────────────────────────────────────────────
describe("list_devices_v2 pagination + projection", () => {
  it("default response is compact, bounds the inline sample, and stays small", async () => {
    const { listDevicesV2 } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listDevicesV2();
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.scope, "all");
    assert.equal(res.result.totalDevices, 60);
    assert.equal(res.result.devices.length, 50);
    assert.equal(res.result.devicesShown, 50);
    assert.equal(res.result.devicesTruncated, true);
    assert.equal(res.result.total, 60);
    assert.equal(res.result.devices[0].rawTelemetry, undefined, "blob dropped by default");
    assert.equal(res.result.devices[0].encryptionEnabled, true);
    assert.ok(JSON.stringify(res.result).length < 40_000, "stays under cap");
  });

  it("size caps returned devices and pages with a cursor", async () => {
    const { listDevicesV2 } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listDevicesV2({ size: 5 });
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.scope, "page");
    assert.equal(res.result.devices.length, 5);
    assert.equal(res.result.pagination.cursor, "c-5");
  });

  it("honours an explicit fields list and the ['*'] escape hatch", async () => {
    const { listDevicesV2 } = await import("../dist/handlers/v2-write.handler.js");
    const onlyId = await listDevicesV2({ size: 2 }, { fields: ["id"] });
    assert.deepEqual(Object.keys(onlyId.result.devices[0]), ["id"]);
    const full = await listDevicesV2({ size: 2 }, { fields: ["*"] });
    assert.ok(full.result.devices[0].rawTelemetry, "['*'] returns full objects");
  });
});

describe("readiness rollup pagination", () => {
  // Fixture-derived expectations (see requirementControls): reqs 1,3,5,7
  // (odd, single ready control) plus req 9 (archived control ignored).
  const FIXTURE_READY = 5;
  const FIXTURE_IN_SCOPE = 9;

  it("size caps the detailed page; framework totals cover all", async () => {
    const { getFrameworkRequirementReadinessRollup } = await import(
      "../dist/handlers/v2-write.handler.js"
    );
    const res = await getFrameworkRequirementReadinessRollup(1, { size: 2 });
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.mappingSource, "v2-controls-expand-requirements");
    assert.equal(res.result.requirements.length, 2, "size caps detailed page");
    assert.equal(res.result.requirementsInResponse, 2);
    assert.equal(res.result.pagination.cursor, "c-2");
    assert.equal(res.result.total, null, "unknown total while more pages remain");

    const fw = res.result.framework;
    assert.equal(fw.readinessSource, "v2-controls-expand-requirements");
    assert.equal(fw.totalRequirements, 10, "totals cover all");
    assert.equal(fw.inScopeRequirements, FIXTURE_IN_SCOPE);
    assert.equal(fw.outOfScopeRequirements, 1);
    assert.equal(fw.readyRequirements, FIXTURE_READY);
    assert.equal(fw.notReadyRequirements, FIXTURE_IN_SCOPE - FIXTURE_READY);
    assert.equal(fw.drataReported, null, "no frameworkId → no Drata cross-check");
    assert.equal(fw.matchesDrataReported, null);

    assert.equal(res.result.controlDetail, "compact");
    assert.deepEqual(
      Object.keys(res.result.requirements[0].controls[0]).sort(),
      ["code", "isReady"],
    );
    assert.deepEqual(res.result.requirements[0].controls, [{ code: "DCF-1", isReady: true }]);
    assert.match(res.result.scopeNote, /archived/);

    // The framework rollup must agree with a full per-requirement walk.
    const full = await getFrameworkRequirementReadinessRollup(1, { size: 100 });
    assert.equal(full.result.requirements.length, 10);
    assert.equal(
      fw.readyRequirements,
      full.result.requirements.filter((r) => r.isReady).length,
    );
    assert.equal(
      fw.inScopeRequirements,
      full.result.requirements.filter((r) => r.isInScope).length,
    );

    // The old per-requirement V1 fan-out is gone; the requirement→controls
    // mapping is built from the V2 controls list's reverse expand instead
    // (the requirement-side expand=controls is capped at 10 inline upstream).
    assert.ok(
      !reqs.some((r) => r.path === "/public/controls"),
      "must not fan out to V1 /public/controls",
    );
    assert.ok(
      reqs.some(
        (r) =>
          r.path === "/public/v2/workspaces/1/controls" &&
          r.query.includes("expand=requirements"),
      ),
      "mapping comes from the controls list with expand=requirements",
    );
  });

  it("includeControlDetail returns full control objects", async () => {
    const { getFrameworkRequirementReadinessRollup } = await import(
      "../dist/handlers/v2-write.handler.js"
    );
    const res = await getFrameworkRequirementReadinessRollup(
      1,
      { size: 1 },
      { includeControlDetail: true },
    );
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.controlDetail, "full");
    const control = res.result.requirements[0].controls[0];
    assert.ok("frameworkTags" in control);
    assert.equal(control.id, 101, "joined from the V2 controls list by id");
    for (const key of ["name", "isMonitored", "hasEvidence", "hasOwner", "evidence"]) {
      assert.ok(key in control, `full control detail includes ${key}`);
    }
    assert.ok(
      reqs.some((r) => r.path === "/public/v2/workspaces/1/controls"),
      "detail join fetches the V2 controls list",
    );
  });

  it("frameworkId cross-checks the derived counts against Drata's own rollup", async () => {
    const { getFrameworkRequirementReadinessRollup } = await import(
      "../dist/handlers/v2-write.handler.js"
    );
    const res = await getFrameworkRequirementReadinessRollup(1, { frameworkId: 1, size: 100 });
    assert.equal(res.isError, false, res.error);
    const fw = res.result.framework;
    assert.equal(fw.drataReported.numReadyInScopeRequirements, 5);
    assert.equal(fw.drataReported.numInScopeRequirements, 9);

    const derivedReady = res.result.requirements.filter((r) => r.isReady).length;
    const derivedInScope = res.result.requirements.filter((r) => r.isInScope).length;
    assert.equal(derivedReady, FIXTURE_READY);
    assert.equal(derivedInScope, FIXTURE_IN_SCOPE);
    assert.equal(fw.matchesDrataReported, 5 === derivedReady && 9 === derivedInScope);
    assert.equal(fw.matchesDrataReported, true);

    // An unknown frameworkId is rejected up front, not silently unfiltered.
    const bad = await getFrameworkRequirementReadinessRollup(1, { frameworkId: 999 });
    assert.equal(bad.isError, true);
    assert.match(bad.error, /No framework with id 999/);
  });

  it("archived-only requirement is out of scope; archived controls stay out of controls[]", async () => {
    const { getFrameworkRequirementReadinessRollup } = await import(
      "../dist/handlers/v2-write.handler.js"
    );
    const res = await getFrameworkRequirementReadinessRollup(1, { size: 100 });
    assert.equal(res.isError, false, res.error);

    const req10 = res.result.requirements.find((r) => r.id === 10);
    assert.ok(req10, "archived-only requirement is still listed");
    assert.equal(req10.isInScope, false);
    assert.equal(req10.isReady, false);
    assert.equal(req10.controlCount, 0, "controlCount counts live controls only");
    assert.equal(req10.archivedControlCount, 2);
    assert.deepEqual(req10.controls, [], "archived controls are excluded from controls[]");

    // Mixed requirement: the archived not-ready control must not block readiness.
    const req9 = res.result.requirements.find((r) => r.id === 9);
    assert.equal(req9.isInScope, true);
    assert.equal(req9.isReady, true, "archived not-ready control is ignored");
    assert.equal(req9.controlCount, 1);
    assert.equal(req9.archivedControlCount, 1);
    assert.deepEqual(req9.controls, [{ code: "DCF-9", isReady: true }]);

    assert.equal(res.result.total, 10, "single-page walk knows the total");
  });
});

// ──────────────────────────────────────────────────────────────
// Error/schema hygiene
// ──────────────────────────────────────────────────────────────
describe("get_task numeric message-code", () => {
  it("maps the bare integer message to a human string", async () => {
    const { getTask } = await import("../dist/handlers/v2-write.handler.js");
    const res = await getTask(1, 1);
    assert.equal(res.isError, true);
    assert.equal(res.httpStatus, 404);
    assert.equal(res.drataMessageCode, 15005);
    assert.match(res.error, /not found/i);
    assert.ok(!res.error.includes("15005"), "no bare integer message in the text");
  });
});

describe("monitoring testId vs monitor id", () => {
  it("resolves a monitor id to its workspace testId (resolve-first, no blind probe)", async () => {
    const { listMonitoringTestFailures } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listMonitoringTestFailures(1, 206);
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.resolvedFromMonitorId, 206);
    assert.equal(res.result.resolvedTestId, 36);
    assert.equal(res.result.testId, 36);
    assert.equal(res.result.testName, "Has a SDLC Policy");
    assert.equal(res.result.checkResultStatus, "PASSED");
    assert.equal(res.result.returned, 1);
    assert.equal(res.result.total, 1);
    assert.equal(
      reqs[0].path,
      "/public/v2/workspaces/1/monitoring-tests",
      "resolves against the monitoring-tests list FIRST",
    );
    assert.ok(reqs.some((r) => r.path === "/public/v2/workspaces/1/monitoring-tests/36/failures"));
    assert.ok(
      !reqs.some((r) => r.path === "/public/v2/workspaces/1/monitoring-tests/206/failures"),
      "never probes /failures with the unresolved monitor id",
    );
  });

  it("a valid testId works directly with no resolution note", async () => {
    const { listMonitoringTestFailures } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listMonitoringTestFailures(1, 8);
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.resolvedFromMonitorId, undefined);
    assert.equal(res.result.testId, 8);
    assert.equal(res.result.monitorId, 205);
    assert.equal(res.result.ambiguityNote, undefined);
  });

  it("a testId that collides with another test's monitor id wins, with an ambiguity note", async () => {
    const { listMonitoringTestFailures } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listMonitoringTestFailures(1, 36);
    assert.equal(res.isError, false, res.error);
    // 36 is the testId of "Has a SDLC Policy" AND the monitor id of
    // "Colliding Test" — the testId interpretation must win.
    assert.equal(res.result.testId, 36);
    assert.equal(res.result.monitorId, 206);
    assert.equal(res.result.testName, "Has a SDLC Policy");
    assert.equal(res.result.resolvedFromMonitorId, undefined);
    assert.equal(typeof res.result.ambiguityNote, "string");
    assert.match(res.result.ambiguityNote, /monitorId: 36/);
    assert.ok(reqs.some((r) => r.path === "/public/v2/workspaces/1/monitoring-tests/36/failures"));
  });

  it("an explicit monitorId bypasses the collision and hits that test's failures", async () => {
    const { listMonitoringTestFailures } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listMonitoringTestFailures(1, undefined, 36);
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.resolvedFromMonitorId, 36);
    assert.equal(res.result.resolvedTestId, 63);
    assert.equal(res.result.testId, 63);
    assert.equal(res.result.testName, "Colliding Test");
    assert.equal(res.result.checkResultStatus, "FAILED");
    assert.ok(reqs.some((r) => r.path === "/public/v2/workspaces/1/monitoring-tests/63/failures"));
  });

  it("an unknown id returns a clear testId-vs-monitor-id error", async () => {
    const { listMonitoringTestFailures } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listMonitoringTestFailures(1, 99999);
    assert.equal(res.isError, true);
    assert.match(res.error, /testId/);
    assert.match(res.error, /monitorId/);
  });

  it("passing both (or neither of) testId and monitorId is rejected", async () => {
    const { listMonitoringTestFailures } = await import("../dist/handlers/v2-write.handler.js");
    const both = await listMonitoringTestFailures(1, 8, 206);
    assert.equal(both.isError, true);
    assert.match(both.error, /exactly one/);
    const neither = await listMonitoringTestFailures(1);
    assert.equal(neither.isError, true);
    assert.match(neither.error, /exactly one/);
  });
});

describe("get_evidence_library_item expand enum", () => {
  it("rejects an undocumented expand value and accepts documented ones", async () => {
    const { EvidenceLibraryCoverageTools } = await import(
      "../dist/tools/v2/evidence-library-coverage.tools.js"
    );
    const tool = EvidenceLibraryCoverageTools.find((f) => f().name === "get_evidence_library_item")();
    const zodModule = await import("zod");
    const z = zodModule.z ?? zodModule.default;
    const wrapped = z.object(tool.schema);
    assert.equal(wrapped.safeParse({ itemId: 1, expand: ["versions"] }).success, false);
    assert.equal(wrapped.safeParse({ itemId: 1, expand: ["controls"] }).success, true);
  });
});

describe("check_monitors error filter", () => {
  it("error filter isolates ERROR-state monitors; failing includes them", async () => {
    const { checkMonitors } = await import("../dist/handlers/check-monitors.handler.js");
    const errorOnly = await checkMonitors("error");
    assert.deepEqual(
      errorOnly.result.monitors.map((m) => m.id),
      [40],
    );
    const failing = await checkMonitors("failing");
    assert.deepEqual(failing.result.monitors.map((m) => m.id).sort((a, b) => a - b), [40, 138]);
  });

  it("schema advertises the error filter", async () => {
    const { default: tool } = await import("../dist/tools/check/check-monitors.tool.js");
    const zodModule = await import("zod");
    const z = zodModule.z ?? zodModule.default;
    const wrapped = z.object(tool().schema);
    assert.equal(wrapped.safeParse({ filter: "error" }).success, true);
  });
});

// ──────────────────────────────────────────────────────────────
// GitHub
// ──────────────────────────────────────────────────────────────
describe("GitHub setup hint + org discovery", () => {
  it("missing PAT yields a setup hint naming the Drata-connected org", async () => {
    const prev = process.env.GITHUB_PAT;
    delete process.env.GITHUB_PAT;
    try {
      const { scanGitHubRepos } = await import("../dist/handlers/github-scan.handler.js");
      const res = await scanGitHubRepos();
      assert.equal(res.isError, true);
      assert.match(res.error, /GITHUB_PAT/);
      assert.match(res.error, /example-org/);
    } finally {
      if (prev !== undefined) process.env.GITHUB_PAT = prev;
    }
  });

  it("owner is optional on the repo-scoped scan tools", async () => {
    const { GitHubTools } = await import("../dist/tools/github/index.js");
    const zodModule = await import("zod");
    const z = zodModule.z ?? zodModule.default;
    for (const name of [
      "scan_github_branch_protection",
      "scan_github_collaborators",
      "scan_github_vulnerabilities",
    ]) {
      const tool = GitHubTools.find((f) => f().name === name)();
      const wrapped = z.object(tool.schema);
      assert.equal(wrapped.safeParse({ repo: "x" }).success, true, `${name} owner optional`);
    }
  });
});
