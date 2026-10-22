import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// Regression tests for output accuracy across assorted tools:
//  - get_recent_events keeps the upstream per-event status (PASSED/FAILED/
//    ERROR/null) and signals hasMore + the limit=50 clamp, counts first.
//  - run_gap_analysis buckets failing monitors by the monitor's OWN priority
//    (not all-critical), marks ERROR monitors as "could not evaluate", and
//    carries a semanticsNote about what is/is not assessed.
//  - list_external_evidence / list_control_mapped_requirements flag the
//    upstream 200-empty-on-nonexistent-parent quirk with a note.
//  - deleteExternalEvidence passes the dry-run sentinel through (with the
//    "DRY RUN" note) instead of reporting {deleted: true}.
//  - error-mapping: message-code 17003 (plan gating) decoded; code 17015
//    (RISK_NOT_FOUND) hints at wrong riskRegisterId; resolveRiskRegisterId
//    does not assert that list_risk_registers is 402-gated.
//  - list_device_apps fields example uses installedApp (the only data field).

let server;
let baseUrl;
let requests = [];

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function v1Page(data) {
  return { data, page: 1, limit: Math.max(data.length, 50), total: data.length };
}

function makeEvent(id, status) {
  return {
    id: `ev-${id}`,
    type: "AP_TEST",
    category: "OBSERVABILITY",
    source: "AWS",
    description: "Drata validates that multiple availability zones are utilized.",
    metadata: {},
    status,
    createdAt: "2026-07-29T12:00:00Z",
    user: null,
    connection: null,
    requestDescription: null,
  };
}

const EVENT_STATUSES = ["FAILED", "PASSED", null, "ERROR", null];

function makeV2Control(id, code, overrides = {}) {
  return {
    id,
    code,
    name: `Control ${code}`,
    archivedAt: null,
    flags: {
      isReady: true,
      isMonitored: true,
      hasOwner: true,
      hasEvidence: true,
      hasPolicy: true,
    },
    evidenceIds: { validExternalEvidenceIds: [1] },
    testIds: { monitored: [1], passing: [1], failing: [] },
    frameworkTags: ["SOC_2"],
    ...overrides,
  };
}

function makeMonitor(id, name, checkResultStatus, priority) {
  return {
    id,
    name,
    description: `${name} pass criteria`,
    checkResultStatus,
    checkStatus: "ENABLED",
    disabledMessage: null,
    priority,
    lastCheck: "2026-07-29T12:00:00Z",
    monitorInstances: [
      {
        id: id * 10,
        checkResultStatus,
        checkFrequency: "DAILY",
        autopilotTaskType: "X",
        failedTestDescription: `Static failure template for ${name}.`,
        evidenceCollectionDescription: "",
        monitorInstanceCheckTypes: [],
      },
    ],
  };
}

const MONITORS = [
  makeMonitor(1, "Critical thing", "FAILED", "CRITICAL"),
  makeMonitor(2, "High thing", "FAILED", "HIGH"),
  makeMonitor(3, "Normal thing", "FAILED", "NORMAL"),
  makeMonitor(4, "Low thing", "FAILED", "LOW"),
  makeMonitor(5, "Errored scanner", "ERROR", "NORMAL"),
  makeMonitor(6, "Healthy check", "PASSED", "HIGH"),
];

const EXTERNAL_EVIDENCE = [
  { id: 13, name: "Scanner Evidence", file: "x.pdf", url: null },
];

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    requests.push({ method: req.method, path: url.pathname, query: url.search });

    if (url.pathname === "/public/events") {
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const events = Array.from({ length: Math.min(limit, 5) }, (_, i) =>
        makeEvent(i + 1, EVENT_STATUSES[i % EVENT_STATUSES.length]),
      );
      return json(res, { data: events, page: 1, limit, total: 9999999 });
    }
    if (url.pathname === "/public/v2/workspaces/1/controls") {
      return json(res, {
        data: [makeV2Control(90, "DCF-37"), makeV2Control(91, "DCF-38")],
        pagination: { cursor: null },
      });
    }
    if (url.pathname === "/public/monitors") return json(res, v1Page(MONITORS));
    if (url.pathname === "/public/personnel") return json(res, v1Page([{ id: 1 }]));
    if (url.pathname === "/public/vendors") return json(res, v1Page([{ id: 1, name: "V" }]));
    if (url.pathname === "/public/policies") return json(res, v1Page([{ id: 1 }]));
    if (url.pathname === "/public/connections") return json(res, v1Page([{ id: 1 }]));
    if (url.pathname === "/public/controls/101/external-evidence") {
      return json(res, v1Page(EXTERNAL_EVIDENCE));
    }
    if (url.pathname === "/public/controls/999999/external-evidence") {
      return json(res, v1Page([]));
    }
    if (url.pathname === "/public/controls/999999/requirements") {
      return json(res, { data: [], page: 1, limit: 20, total: 0 });
    }
    if (url.pathname === "/public/controls/199/requirements") {
      if (url.searchParams.get("frameworkSlug") === "nonsense-slug") {
        return json(res, { data: [], page: 1, limit: 20, total: 0 });
      }
      return json(res, {
        data: [{ id: 1, name: "P7.1" }, { id: 2, name: "PI1.2" }],
        page: 1,
        limit: 20,
        total: 2,
      });
    }
    if (req.method === "DELETE" && url.pathname === "/public/external-evidence/13") {
      res.statusCode = 204;
      return res.end();
    }
    return json(res, { data: [], page: 1, limit: 50, total: 0 });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  process.env.DRATA_API_KEY = "test-key";
  process.env.DRATA_BASE_URL = baseUrl;
  process.env.DRATA_WORKSPACE_ID = "1";
  delete process.env.DRATA_RISK_REGISTER_ID;
  delete process.env.DRATA_MCP_DRY_RUN;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("get_recent_events keeps upstream status and signals pagination", () => {
  it("each event carries the upstream status verbatim (incl. null)", async () => {
    const { getRecentEvents } = await import("../dist/handlers/get-recent-events.handler.js");
    const res = await getRecentEvents(5);
    assert.equal(res.isError, false, `unexpected error: ${res.error}`);
    assert.deepEqual(
      res.result.events.map((e) => e.status),
      ["FAILED", "PASSED", null, "ERROR", null],
    );
  });

  it("counts and continuation signals serialize BEFORE the events array", async () => {
    const { getRecentEvents } = await import("../dist/handlers/get-recent-events.handler.js");
    const res = await getRecentEvents(5);
    const keys = Object.keys(res.result);
    assert.ok(keys.indexOf("count") < keys.indexOf("events"));
    assert.ok(keys.indexOf("hasMore") < keys.indexOf("events"));
    assert.equal(res.result.count, 5);
    assert.equal(res.result.limit, 5);
    assert.equal(res.result.hasMore, true, "full page must set hasMore");
    assert.match(res.result.note, /list_events_v2/);
  });

  it("limit above 50 is clamped and the clamp is stated in the note", async () => {
    const { getRecentEvents } = await import("../dist/handlers/get-recent-events.handler.js");
    const res = await getRecentEvents(100);
    assert.equal(res.isError, false);
    assert.equal(res.result.limit, 50);
    assert.match(res.result.note, /clamped to 50/);
  });

  it("short page (server has fewer events) → hasMore false, no note", async () => {
    const { getRecentEvents } = await import("../dist/handlers/get-recent-events.handler.js");
    // Mock serves at most 5 events; ask for 10.
    const res = await getRecentEvents(10);
    assert.equal(res.result.count, 5);
    assert.equal(res.result.hasMore, false);
    assert.equal("note" in res.result, false);
  });
});

describe("run_gap_analysis buckets monitors by their own priority", () => {
  it("CRITICAL/HIGH/NORMAL/LOW failing monitors land in matching severity buckets", async () => {
    const { runGapAnalysis } = await import("../dist/handlers/run-gap-analysis.handler.js");
    const res = await runGapAnalysis();
    assert.equal(res.isError, false, `unexpected error: ${res.error}`);
    const { critical, high, medium, low } = res.result.gaps;
    assert.ok(critical.some((l) => l.includes("Critical thing")), "CRITICAL → critical");
    assert.ok(high.some((l) => l.includes("High thing")), "HIGH → high");
    assert.ok(medium.some((l) => l.includes("Normal thing")), "NORMAL → medium");
    assert.ok(low.some((l) => l.includes("Low thing")), "LOW → low");
    // The passing monitor appears in no gap bucket.
    for (const bucket of [critical, high, medium, low]) {
      assert.equal(bucket.some((l) => l.includes("Healthy check")), false);
    }
    // No non-critical monitor leaks into critical anymore.
    assert.equal(critical.some((l) => l.includes("(NORMAL)") || l.includes("(LOW)")), false);
  });

  it("ERROR monitors say the check could not evaluate — never the static failure template", async () => {
    const { runGapAnalysis } = await import("../dist/handlers/run-gap-analysis.handler.js");
    const res = await runGapAnalysis();
    const all = Object.values(res.result.gaps).flat();
    const errLine = all.find((l) => l.includes("Errored scanner"));
    assert.ok(errLine, "errored monitor must still be reported as a gap");
    assert.match(errLine, /MONITOR ERROR/);
    assert.match(errLine, /could not evaluate/);
    assert.equal(errLine.includes("Static failure template"), false);
  });

  it("semanticsNote states what is NOT assessed and appears before gaps", async () => {
    const { runGapAnalysis } = await import("../dist/handlers/run-gap-analysis.handler.js");
    const res = await runGapAnalysis();
    const keys = Object.keys(res.result);
    assert.ok(keys.indexOf("semanticsNote") < keys.indexOf("gaps"));
    assert.match(res.result.semanticsNote, /NOT assessed/);
    assert.match(res.result.semanticsNote, /check_personnel_compliance/);
  });

  it("with frameworkFilter, semanticsNote flags that only controls are scoped", async () => {
    const { runGapAnalysis } = await import("../dist/handlers/run-gap-analysis.handler.js");
    const res = await runGapAnalysis("SOC 2");
    assert.equal(res.isError, false, `unexpected error: ${res.error}`);
    assert.match(res.result.semanticsNote, /scopes CONTROLS only/);
    // Monitor numbers stay tenant-wide.
    assert.equal(res.result.overview.totalMonitors, MONITORS.length);
  });
});

describe("silent-empty guards on V1 control sub-resources", () => {
  it("list_external_evidence: empty result carries the nonexistent-parent note before the array", async () => {
    const { listExternalEvidence } = await import("../dist/handlers/write-evidence.handler.js");
    const res = await listExternalEvidence(999999);
    assert.equal(res.isError, false);
    assert.equal(res.result.count, 0);
    assert.match(res.result.note, /nonexistent controlId/);
    assert.match(res.result.note, /get_control/);
    const keys = Object.keys(res.result);
    assert.ok(keys.indexOf("note") < keys.indexOf("evidence"));
  });

  it("list_external_evidence: non-empty result has no note", async () => {
    const { listExternalEvidence } = await import("../dist/handlers/write-evidence.handler.js");
    const res = await listExternalEvidence(101);
    assert.equal(res.result.count, 1);
    assert.equal("note" in res.result, false);
  });

  it("list_control_mapped_requirements: counts lead, empty pages are flagged", async () => {
    const { listControlMappedRequirements } = await import(
      "../dist/handlers/write-evidence.handler.js"
    );
    const empty = await listControlMappedRequirements(999999);
    assert.equal(empty.isError, false);
    assert.equal(empty.result.total, 0);
    assert.match(empty.result.note, /nonexistent controlId/);
    const keys = Object.keys(empty.result);
    assert.ok(keys.indexOf("total") < keys.indexOf("requirements"));
    assert.ok(keys.indexOf("note") < keys.indexOf("requirements"));

    const full = await listControlMappedRequirements(199);
    assert.equal(full.result.total, 2);
    assert.equal(full.result.returned, 2);
    assert.equal("note" in full.result, false);
    assert.equal(full.result.requirements.length, 2);
  });

  it("list_control_mapped_requirements: bad frameworkSlug empties are called out", async () => {
    const { listControlMappedRequirements } = await import(
      "../dist/handlers/write-evidence.handler.js"
    );
    const res = await listControlMappedRequirements(199, { frameworkSlug: "nonsense-slug" });
    assert.equal(res.result.returned, 0);
    assert.match(res.result.note, /frameworkSlug/);
  });
});

describe("dry-run reporting for deletes", () => {
  it("deleteExternalEvidence passes the dry-run sentinel through, with the DRY RUN note", async () => {
    const { deleteExternalEvidence } = await import("../dist/handlers/write-evidence.handler.js");
    process.env.DRATA_MCP_DRY_RUN = "1";
    requests = [];
    try {
      const res = await deleteExternalEvidence(13);
      assert.equal(res.isError, false);
      assert.equal(res.result.dryRun, true);
      assert.match(res.result.note, /DRY RUN — no mutation was performed/);
      assert.equal("deleted" in res.result, false, "a dry run must not report {deleted: true}");
      assert.equal(requests.length, 0, "dry-run must not hit the network");
    } finally {
      delete process.env.DRATA_MCP_DRY_RUN;
    }
  });

  it("without dry-run, deleteExternalEvidence performs the DELETE and reports it", async () => {
    const { deleteExternalEvidence } = await import("../dist/handlers/write-evidence.handler.js");
    requests = [];
    const res = await deleteExternalEvidence(13);
    assert.equal(res.isError, false);
    assert.deepEqual(res.result, { deleted: true, evidenceId: 13 });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "DELETE");
  });

  it("V2 mutation dry-run sentinels also carry the note", async () => {
    const { getDrataClient } = await import("../dist/clients/drata-client.js");
    process.env.DRATA_MCP_DRY_RUN = "1";
    requests = [];
    try {
      const sentinel = await getDrataClient().postV2("/public/v2/anything", { a: 1 });
      assert.equal(sentinel.dryRun, true);
      assert.match(sentinel.note, /DRY RUN — no mutation was performed/);
      assert.equal(requests.length, 0);
    } finally {
      delete process.env.DRATA_MCP_DRY_RUN;
    }
  });
});

describe("error-mapping: 17003 plan gating and 17015 wrong-register hint", () => {
  it("HTTP 403 message-code 17003 decodes to plan/permission gating (not a bare number)", async () => {
    const { mapDrataError } = await import("../dist/helpers/error-mapping.js");
    const mapped = mapDrataError(
      new Error(
        'Drata V2 API error 403 on /public/v2/control-library: {"statusCode":403,"message":17003,"code":10000}',
      ),
    );
    assert.equal(mapped.isError, true);
    assert.equal(mapped.drataMessageCode, 17003);
    assert.equal(mapped.httpStatus, 403);
    assert.match(mapped.error, /plan\/permission gating/);
    assert.match(mapped.error, /Custom Frameworks/);
    // The generic code-10000 (templated-evidence) hint must NOT attach here.
    assert.equal(mapped.hint === undefined || !/[Tt]emplated evidence/.test(mapped.hint), true);
  });

  it("code 17015 RISK_NOT_FOUND hints at verifying riskRegisterId", async () => {
    const { mapDrataError } = await import("../dist/helpers/error-mapping.js");
    const mapped = mapDrataError(
      new Error(
        'Drata V2 API error 404 on /public/v2/risk-registers/999999/risks/1: {"statusCode":404,"message":"RISK_NOT_FOUND: Risk not found: 1","code":17015}',
      ),
    );
    assert.equal(mapped.drataCode, 17015);
    assert.match(mapped.hint, /riskRegisterId/);
    assert.match(mapped.hint, /list_risk_registers/);
  });
});

describe("resolveRiskRegisterId does not assert the enumerator is 402-gated", () => {
  it("error suggests trying list_risk_registers instead of claiming it is gated", async () => {
    const { getDrataClient } = await import("../dist/clients/drata-client.js");
    const client = getDrataClient();
    assert.throws(
      () => client.resolveRiskRegisterId(undefined),
      (err) => {
        assert.match(err.message, /Try list_risk_registers first/);
        assert.match(err.message, /commonly 1/);
        assert.equal(
          /is gated behind Risk Management Pro \(HTTP 402\) on this account/.test(err.message),
          false,
          "must not assert the enumerator is 402-gated as fact",
        );
        return true;
      },
    );
  });
});

describe("list_device_apps schema documents the real field names", () => {
  it("fields example uses installedApp, not the nonexistent name/version", async () => {
    const { LibraryDeviceReadTools } = await import(
      "../dist/tools/v2/library-device-reads.tools.js"
    );
    const tool = LibraryDeviceReadTools.map((f) => f()).find(
      (t) => t.name === "list_device_apps",
    );
    assert.ok(tool, "list_device_apps must exist");
    assert.match(tool.description, /installedApp/);
    const fieldsDesc = tool.schema.fields.description;
    assert.match(fieldsDesc, /installedApp/);
    assert.equal(fieldsDesc.includes('["name", "version"]'), false);
  });
});
