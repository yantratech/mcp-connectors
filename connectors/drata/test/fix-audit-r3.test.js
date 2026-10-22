/**
 * Regression tests for evidence download URLs, archived risks, control flags
 * and errored monitors:
 *
 *  - get_external_evidence_download_url: the presigned signedUrl dies
 *    ~60s after signing (X-Amz-Expires enforced by S3) but the upstream body
 *    carries no expiry field — the tool now surfaces the parsed expiry and a
 *    short-lived note BEFORE the payload.
 *  - list_risks: the raw V2 list folds ARCHIVED risks into rows and
 *    totalCount, overstating the register against the app's count. Archived rows
 *    are now excluded by default with archivedRisksExcluded reported before
 *    the array; includeArchived / an explicit status filter restore them.
 *  - get_control expand:["flags"]: flags.hasEvidence is Drata's narrow
 *    flag (external uploads + evidence-library reports only) — now labelled
 *    inline under the connector's established semanticsNote key, mirroring
 *    list_controls and check_control_status.
 *  - get_compliance_summary: failingMonitors silently folded ERROR
 *    monitors (checks that could not evaluate) into the failing count — now
 *    broken out as errorMonitors with a composition note.
 *
 * Mock Drata HTTP server; handlers/tools driven from dist/. No live calls.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

let server;
let baseUrl;
/** Every request the mock server saw: { method, pathname, params }. */
const seenRequests = [];

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

const SIGNED_URL =
  "https://example-bucket.s3.eu-central-1.amazonaws.com/evidence/evidence-report.pdf" +
  "?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20260811T110740Z&X-Amz-Expires=60&X-Amz-Signature=abc123&x-id=GetObject";

// No X-Amz-* lifetime in the querystring — the generic short-lived note path.
const OPAQUE_URL = "https://files.example.com/evidence/report.pdf?token=xyz";

function makeRisk(id, status) {
  return {
    id,
    riskId: `CR-0${id}`,
    title:
      status === "ARCHIVED" ? "E2E Test Risk - ARCHIVED" : `Live risk ${id}`,
    status,
    score: 9,
  };
}

// 5 risks: 3 ACTIVE + 1 CLOSED (both must survive the default filter),
// 1 ARCHIVED (must be held back by default).
const RISKS = [
  makeRisk(1, "ARCHIVED"),
  makeRisk(2, "ACTIVE"),
  makeRisk(3, "ACTIVE"),
  makeRisk(4, "CLOSED"),
  makeRisk(5, "ACTIVE"),
];

const CONTROL_FLAGS = {
  hasEvidence: false,
  hasPolicy: true,
  hasTicket: false,
  isReady: false,
  isMonitored: true,
  hasOwner: true,
};

function makeMonitor(id, checkResultStatus, checkStatus = "ENABLED") {
  return {
    id,
    name: `Monitor ${id}`,
    checkResultStatus,
    checkStatus,
    disabledMessage: checkStatus === "DISABLED" ? "off" : null,
    priority: "HIGH",
    lastCheck: "2026-08-11T06:04:00Z",
    monitorInstances: [],
  };
}

// 2 passing (PASSED + legacy READY), 1 FAILED, 2 ERROR, 1 disabled.
// failingMonitors = 3 (FAILED + 2 ERROR), errorMonitors = 2,
// app-equivalent Failed tab = 1.
const MONITORS = [
  makeMonitor(1, "PASSED"),
  makeMonitor(2, "READY"),
  makeMonitor(3, "FAILED"),
  makeMonitor(4, "ERROR"),
  makeMonitor(5, "ERROR"),
  makeMonitor(6, "FAILED", "DISABLED"),
];

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const params = Object.fromEntries(url.searchParams);
    seenRequests.push({ method: req.method, pathname: url.pathname, params });

    // external evidence download URLs
    if (url.pathname === "/public/external-evidence/15/download") {
      return json(res, { fileBuffer: null, fileName: null, signedUrl: SIGNED_URL });
    }
    if (url.pathname === "/public/external-evidence/16/download") {
      return json(res, { fileBuffer: null, fileName: null, signedUrl: OPAQUE_URL });
    }

    // V2 risks list with status filter, size, cursor, totalCount
    if (url.pathname === "/public/v2/risk-registers/1/risks") {
      let rows = params.status
        ? RISKS.filter((r) => r.status === params.status)
        : RISKS;
      const totalCount =
        params.includeTotalCount === "true" ? rows.length : undefined;
      let cursor = null;
      if (params.size) {
        const size = Number(params.size);
        const start = params.cursor === "c2" ? size : 0;
        const page = rows.slice(start, start + size);
        cursor = start + size < rows.length ? "c2" : null;
        rows = page;
      }
      return json(res, {
        data: rows,
        pagination:
          totalCount !== undefined ? { cursor, totalCount } : { cursor },
      });
    }

    // single control, flags gated on expand
    if (url.pathname === "/public/v2/workspaces/1/controls/168") {
      const base = {
        id: 168,
        code: "DCF-4",
        name: "Password Manager Deployed",
        archivedAt: null,
      };
      if (url.searchParams.getAll("expand").includes("flags")) {
        return json(res, { ...base, flags: { ...CONTROL_FLAGS } });
      }
      return json(res, base);
    }

    // compliance summary inputs
    if (url.pathname === "/public/v2/workspaces/1/controls") {
      return json(res, { data: [], pagination: { cursor: null } });
    }
    if (url.pathname === "/public/monitors") {
      return json(res, { data: MONITORS, page: 1, limit: 50, total: MONITORS.length });
    }
    // Remaining V1 lists the summary aggregates (personnel, vendors, ...)
    return json(res, { data: [], page: 1, limit: 50, total: 0 });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  process.env.DRATA_API_KEY = "test-key";
  process.env.DRATA_BASE_URL = baseUrl;
  process.env.DRATA_WORKSPACE_ID = "1";
  process.env.DRATA_RISK_REGISTER_ID = "1";
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function getTool(modulePath, exportName, toolName) {
  const mod = await import(modulePath);
  const factory = mod[exportName].find((f) => f().name === toolName);
  return factory();
}

async function callTool(tool, args) {
  const result = await tool.handler(args);
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  return JSON.parse(result.content[0].text);
}

// ──────────────────────────────────────────────────────────────
// get_external_evidence_download_url: expiry surfaced
// ──────────────────────────────────────────────────────────────
describe("get_external_evidence_download_url labels the short-lived URL", () => {
  it("parses X-Amz-Date/X-Amz-Expires into expiry fields and a note before the payload", async () => {
    const tool = await getTool(
      "../dist/tools/write/control-evidence-lifecycle.tools.js",
      "ControlEvidenceLifecycleTools",
      "get_external_evidence_download_url",
    );
    const payload = await callTool(tool, { evidenceId: 15 });
    assert.equal(payload.urlExpiresInSeconds, 60);
    assert.equal(payload.urlExpiresAt, "2026-08-11T11:08:40.000Z");
    assert.match(payload.note, /short-lived/);
    assert.match(payload.note, /expires 60s after signing/);
    assert.match(payload.note, /re-call this tool/i);
    // Old-bug shape: the upstream body passed through bare. The payload must
    // still be intact, with the expiry annotation serialized FIRST so a
    // truncated response loses the URL, never the warning.
    assert.equal(payload.signedUrl, SIGNED_URL);
    assert.equal(payload.fileBuffer, null);
    assert.equal(payload.fileName, null);
    assert.deepEqual(Object.keys(payload).slice(0, 3), [
      "urlExpiresInSeconds",
      "urlExpiresAt",
      "note",
    ]);
  });

  it("falls back to the generic ~60s note when the URL carries no parseable lifetime", async () => {
    const tool = await getTool(
      "../dist/tools/write/control-evidence-lifecycle.tools.js",
      "ControlEvidenceLifecycleTools",
      "get_external_evidence_download_url",
    );
    const payload = await callTool(tool, { evidenceId: 16 });
    assert.equal(payload.urlExpiresInSeconds, null);
    assert.equal(payload.urlExpiresAt, null);
    assert.match(payload.note, /short-lived/);
    assert.match(payload.note, /~60s/);
    assert.equal(payload.signedUrl, OPAQUE_URL);
  });
});

// ──────────────────────────────────────────────────────────────
// list_risks: archived excluded by default
// ──────────────────────────────────────────────────────────────
describe("list_risks excludes ARCHIVED risks by default", () => {
  it("default single-page read drops archived rows, keeps CLOSED, and reports the exclusion before the array", async () => {
    seenRequests.length = 0;
    const tool = await getTool(
      "../dist/tools/v2/risk-operations.tools.js",
      "RiskOperationsTools",
      "list_risks",
    );
    const payload = await callTool(tool, { riskRegisterId: 1 });
    // Old-bug shape: total 5 with the ARCHIVED artifact in rows. Now the
    // default total matches the app's register (ACTIVE + CLOSED).
    assert.equal(payload.total, 4);
    assert.equal(payload.returned, 4);
    assert.equal(payload.archivedRisksExcluded, 1);
    assert.equal(payload.risks.some((r) => r.status === "ARCHIVED"), false);
    assert.equal(payload.risks.some((r) => r.status === "CLOSED"), true, "CLOSED must NOT be dropped");
    assert.deepEqual(Object.keys(payload), [
      "total",
      "returned",
      "archivedRisksExcluded",
      "pagination",
      "risks",
    ]);
    // Wire: a single upstream call, rows filtered locally — no status param.
    assert.equal(seenRequests.length, 1);
    assert.equal("status" in seenRequests[0].params, false);
  });

  it("paginated read corrects the archived-contaminated totalCount via an archived-count probe", async () => {
    seenRequests.length = 0;
    const tool = await getTool(
      "../dist/tools/v2/risk-operations.tools.js",
      "RiskOperationsTools",
      "list_risks",
    );
    // First page of 2 (1 ARCHIVED + 1 ACTIVE), upstream totalCount 5.
    const payload = await callTool(tool, {
      riskRegisterId: 1,
      size: 2,
      includeTotalCount: true,
    });
    assert.equal(payload.total, 4, "upstream 5 minus 1 archived");
    assert.equal(payload.archivedRisksExcluded, 1);
    assert.equal(payload.returned, 1, "the archived row is held back from the page");
    assert.equal(payload.pagination.cursor, "c2", "cursor still advances");
    // Wire: main page request (no status) + archived-count probe.
    assert.equal(seenRequests.length, 2);
    assert.equal("status" in seenRequests[0].params, false);
    assert.deepEqual(seenRequests[1].params, {
      status: "ARCHIVED",
      size: "1",
      includeTotalCount: "true",
    });
  });

  it("includeArchived: true restores the raw register (the old default shape, now opt-in)", async () => {
    seenRequests.length = 0;
    const tool = await getTool(
      "../dist/tools/v2/risk-operations.tools.js",
      "RiskOperationsTools",
      "list_risks",
    );
    const payload = await callTool(tool, { riskRegisterId: 1, includeArchived: true });
    assert.equal(payload.total, 5);
    assert.equal(payload.risks.some((r) => r.status === "ARCHIVED"), true);
    // The breakdown field is always present (0 = nothing held back), matching
    // the excludedArchived/archivedControlsExcluded siblings.
    assert.equal(payload.archivedRisksExcluded, 0);
    assert.deepEqual(Object.keys(payload), [
      "total",
      "returned",
      "archivedRisksExcluded",
      "pagination",
      "risks",
    ]);
    assert.equal(seenRequests.length, 1);
  });

  it("an explicit status filter passes through untouched (status: ARCHIVED still reachable)", async () => {
    const tool = await getTool(
      "../dist/tools/v2/risk-operations.tools.js",
      "RiskOperationsTools",
      "list_risks",
    );
    const payload = await callTool(tool, { riskRegisterId: 1, status: "ARCHIVED" });
    assert.equal(payload.total, 1);
    assert.deepEqual(payload.risks.map((r) => r.status), ["ARCHIVED"]);
    assert.equal(payload.archivedRisksExcluded, 0);
  });
});

// ──────────────────────────────────────────────────────────────
// get_control: narrow hasEvidence labelled inline
// ──────────────────────────────────────────────────────────────
describe('get_control expand:["flags"] carries the hasEvidence semantics caveat', () => {
  it("injects semanticsNote (list_controls' established key) inside flags, before hasEvidence, leaving flag values intact", async () => {
    const tool = await getTool(
      "../dist/tools/v2/library-device-reads.tools.js",
      "LibraryDeviceReadTools",
      "get_control",
    );
    const payload = await callTool(tool, { controlId: 168, expand: ["flags"] });
    assert.match(payload.flags.semanticsNote, /narrow flag/);
    assert.match(payload.flags.semanticsNote, /mapped policies and monitor tests/);
    assert.match(payload.flags.semanticsNote, /check_control_status/);
    // The note must serialize BEFORE the flag it qualifies.
    const keys = Object.keys(payload.flags);
    assert.ok(
      keys.indexOf("semanticsNote") < keys.indexOf("hasEvidence"),
      `note must precede hasEvidence, got ${keys.join(", ")}`,
    );
    // Old-bug shape: flags passed through unlabelled. Values stay verbatim.
    for (const [key, value] of Object.entries(CONTROL_FLAGS)) {
      assert.equal(payload.flags[key], value);
    }
    assert.equal(payload.code, "DCF-4");
  });

  it("without the flags expand, no note is injected", async () => {
    const tool = await getTool(
      "../dist/tools/v2/library-device-reads.tools.js",
      "LibraryDeviceReadTools",
      "get_control",
    );
    const payload = await callTool(tool, { controlId: 168 });
    assert.equal("flags" in payload, false);
    assert.equal("semanticsNote" in payload, false);
  });

  it("the tool description itself documents the narrow-flag caveat", async () => {
    const tool = await getTool(
      "../dist/tools/v2/library-device-reads.tools.js",
      "LibraryDeviceReadTools",
      "get_control",
    );
    assert.match(tool.description, /flags\.hasEvidence is Drata's narrow flag/);
    assert.match(tool.description, /check_control_status/);
  });
});

// ──────────────────────────────────────────────────────────────
// get_compliance_summary: errorMonitors broken out
// ──────────────────────────────────────────────────────────────
describe("get_compliance_summary breaks ERROR monitors out of failingMonitors", () => {
  it("keeps failingMonitors semantics (FAILED + ERROR, disabled excluded) and reports errorMonitors beside it", async () => {
    const { getComplianceSummary } = await import(
      "../dist/handlers/get-compliance-summary.handler.js"
    );
    const res = await getComplianceSummary();
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.totalMonitors, 6);
    assert.equal(res.result.passingMonitors, 2);
    // Backward-compatible: failing still folds ERROR in (old value)...
    assert.equal(res.result.failingMonitors, 3);
    // ...but the fold is no longer silent.
    assert.equal(res.result.errorMonitors, 2);
    // The caveat rides under `note` — the same established key check_monitors
    // uses for its equivalent caveat.
    assert.match(res.result.note, /failingMonitors includes errorMonitors/);
    assert.match(res.result.note, /could not evaluate/);
    // App-equivalent Failed tab is recoverable from the two fields.
    assert.equal(res.result.failingMonitors - res.result.errorMonitors, 1);
    // errorMonitors sits right next to the count it qualifies.
    const keys = Object.keys(res.result);
    assert.equal(keys[keys.indexOf("failingMonitors") + 1], "errorMonitors");
  });
});
