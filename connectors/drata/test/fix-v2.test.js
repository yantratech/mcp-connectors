import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// Regression tests for V2 tool output accuracy: counts-before-arrays
// envelopes, capped default pages instead of merging every page, client-side
// frameworkId validation/filtering, per-version policy-assignment
// enrichment, overdue-inclusive upcoming tasks, loud `since` rejection,
// silent-empty guards on per-parent lists, and self-identifying policy
// version content. Own mock Drata API; no live calls.

let server;
let baseUrl;
let reqs;

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

// Generic cursor-paged collection: honors size/cursor ("c-<offset>") and
// includeTotalCount, mirroring Drata's V2 envelope.
function paged(url, all) {
  const sizeParam = url.searchParams.get("size");
  const size = sizeParam !== null ? Number(sizeParam) : all.length;
  const cursorParam = url.searchParams.get("cursor");
  const start = cursorParam ? Number(cursorParam.slice(2)) : 0;
  const slice = all.slice(start, start + size);
  const end = start + slice.length;
  const pagination = { cursor: end < all.length ? `c-${end}` : null };
  if (url.searchParams.get("includeTotalCount") === "true") {
    pagination.totalCount = all.length;
  }
  return { data: slice, pagination };
}

const EVIDENCE = Array.from({ length: 60 }, (_, i) => ({
  id: i + 1,
  name: `Evidence ${i + 1}`,
  status: "READY",
}));

const MONITORING_TESTS = Array.from({ length: 60 }, (_, i) => ({
  id: 200 + i,
  testId: i + 1,
  name: `Test ${i + 1}`,
  checkResultStatus: "PASSED",
}));

const FRAMEWORKS = [
  { id: 1, tag: "SOC_2", slug: "soc2" },
  { id: 2, tag: "ISO27001", slug: "iso27001" },
];

// Mixed-framework requirement list — the endpoint IGNORES the frameworkId
// query param exactly like the live API does.
const REQUIREMENTS = [
  { id: 1, name: "CC1.1", frameworkTag: "SOC_2", frameworkSlug: "soc2", additionalInfo: "x".repeat(500), additionalInfo2: null, additionalInfo3: null, description: "d1" },
  { id: 2, name: "CC1.2", frameworkTag: "SOC_2", frameworkSlug: "soc2", additionalInfo: "y".repeat(500), additionalInfo2: null, additionalInfo3: null, description: "d2" },
  { id: 3, name: "A.5.1", frameworkTag: "ISO27001", frameworkSlug: "iso27001", additionalInfo: "z".repeat(500), additionalInfo2: null, additionalInfo3: null, description: "d3" },
];

const POLICIES = [
  { id: 101, name: "Physical Security Policy", status: "ACTIVE", currentVersionId: 201 },
  { id: 102, name: "Retired Policy", status: "REPLACED", currentVersionId: null },
  { id: 103, name: "Example Conduct Policy", status: "ACTIVE", currentVersionId: 203 },
];

const ASSIGNED_POLICIES = [
  // Accepted on the current version — fine.
  { id: 301, policyId: 101, policyVersionId: 201, acceptedAt: "2026-05-18T12:00:00.000Z", sourceType: "MY_DRATA" },
  // Superseded version of the same policy — acceptedAt null forever.
  { id: 302, policyId: 101, policyVersionId: 202, acceptedAt: null, sourceType: "UNKNOWN" },
  // REPLACED policy — acceptedAt null forever.
  { id: 303, policyId: 102, policyVersionId: 9, acceptedAt: null, sourceType: "UNKNOWN" },
  // Genuinely outstanding: current version of an ACTIVE policy, not accepted.
  { id: 304, policyId: 103, policyVersionId: 203, acceptedAt: null, sourceType: "MY_DRATA" },
];

const POLICY_VERSION_HTML = "<p><strong>Physical Security Policy</strong> body</p>";

before(async () => {
  reqs = [];
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;
    reqs.push({ method: req.method, url: req.url, path, query: url.search, accept: req.headers["accept"] });

    if (path === "/public/v2/workspaces/1/evidence-library") {
      return json(res, paged(url, EVIDENCE));
    }
    if (path === "/public/v2/workspaces/1/monitoring-tests") {
      return json(res, paged(url, MONITORING_TESTS));
    }
    if (path === "/public/v2/workspaces/1/frameworks") {
      return json(res, { data: FRAMEWORKS, pagination: { cursor: null } });
    }
    if (path === "/public/v2/workspaces/1/framework-requirements") {
      // frameworkId deliberately ignored, like the live API.
      return json(res, paged(url, REQUIREMENTS));
    }
    if (path === "/public/v2/policies") {
      return json(res, { data: POLICIES, pagination: { cursor: null } });
    }
    if (path === "/public/v2/users/1/assigned-policies") {
      return json(res, { data: ASSIGNED_POLICIES, pagination: { cursor: null } });
    }
    if (path === "/public/v2/workspaces/1/tasks") {
      return json(res, { data: [], pagination: { cursor: null } });
    }
    if (path === "/public/v2/events") {
      return json(res, {
        data: [
          { id: "e1", createdAt: "2026-07-20T00:00:00.000Z" },
          { id: "e2", createdAt: "2026-06-01T00:00:00.000Z" },
        ],
        pagination: { cursor: null },
      });
    }
    if (path === "/public/v2/policies/101/policy-versions/201") {
      const accept = String(req.headers["accept"] ?? "");
      if (accept.includes("text/html")) {
        res.statusCode = 200;
        res.setHeader("content-type", "text/html");
        return res.end(POLICY_VERSION_HTML);
      }
      return json(res, {
        id: 201,
        version: 1,
        policyVersionStatus: "PUBLISHED",
        current: true,
        policy: { id: 101, name: "Physical Security Policy", policyStatus: 1 },
      });
    }
    if (path === "/public/v2/policies/101/policy-versions") {
      return json(res, {
        data: [
          { id: 201, current: true, policyVersionStatus: "PUBLISHED" },
          { id: 202, current: false, policyVersionStatus: "PUBLISHED" },
        ],
        pagination: { cursor: null },
      });
    }
    // Silent-empty family: 200 + empty list for nonexistent parents,
    // mirroring the live API.
    if (
      path === "/public/v2/policies/999999/policy-versions" ||
      path === "/public/v2/vendors/999999/questionnaires" ||
      path === "/public/v2/vendors/999999/documents" ||
      path === "/public/v2/users/999999/documents" ||
      path === "/public/v2/risk-registers/1/risks/22/notes"
    ) {
      return json(res, { data: [], pagination: { cursor: null } });
    }
    if (path === "/public/v2/vendors/9/questionnaires") {
      return json(res, { data: [{ id: 1, name: "Q1" }], pagination: { cursor: null } });
    }
    if (path === "/public/v2/risk-registers/1/risks/47/notes") {
      return json(res, { data: [{ id: "n1", comment: "note" }], pagination: { cursor: null } });
    }
    if (path === "/public/v2/workspaces/1/controls-requirement-comparison") {
      return json(res, {
        data: [
          { controlId: 999999, alignedRequirements: [], userMappedRequirements: [], templateMappedRequirements: [] },
          { controlId: 61, alignedRequirements: [{ id: 9 }], userMappedRequirements: [], templateMappedRequirements: [] },
        ],
      });
    }
    return json(res, { data: [], pagination: { cursor: null } });
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
// Envelope ordering: counts BEFORE arrays
// ──────────────────────────────────────────────────────────────
describe("V2 envelopes serialize counts before item arrays", () => {
  it("wrapV2List order: total, returned, pagination, items", async () => {
    const { wrapV2List } = await import("../dist/handlers/v2-write.handler.js");
    const env = wrapV2List("things", { data: [{ id: 1 }], pagination: { cursor: null } });
    assert.deepEqual(Object.keys(env), ["total", "returned", "pagination", "things"]);
    assert.equal(env.total, 1);
  });

  it("wrapV2List prefers Drata's totalCount over null while a cursor is outstanding", async () => {
    const { wrapV2List } = await import("../dist/handlers/v2-write.handler.js");
    const env = wrapV2List("things", {
      data: [{ id: 1 }],
      pagination: { cursor: "more", totalCount: 42 },
    });
    assert.equal(env.total, 42);
    assert.equal(env.returned, 1);
  });

  it("wrapV2List still reports total null with a cursor and no totalCount", async () => {
    const { wrapV2List } = await import("../dist/handlers/v2-write.handler.js");
    const env = wrapV2List("things", { data: [{ id: 1 }], pagination: { cursor: "more" } });
    assert.equal(env.total, null);
  });

  it("wrapV2Merged order: total, returned, items", async () => {
    const { wrapV2Merged } = await import("../dist/handlers/v2-write.handler.js");
    const env = wrapV2Merged("things", [{ id: 1 }, { id: 2 }]);
    assert.deepEqual(Object.keys(env), ["total", "returned", "things"]);
    assert.equal(env.total, 2);
  });
});

// ──────────────────────────────────────────────────────────────
// Capped default pages for former auto-merge-all tools
// ──────────────────────────────────────────────────────────────
describe("list_evidence_library / list_monitoring_tests_v2 default caps", () => {
  it("evidence library default returns one capped page with real total and a paging note", async () => {
    const { listEvidenceLibrary } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listEvidenceLibrary();
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.returned, 50, "default page size 50");
    assert.equal(res.result.total, 60, "total from includeTotalCount default");
    assert.match(res.result.note, /First page only \(50 of 60/);
    assert.match(res.result.note, /fetchAll/);
    // note and counts precede the items array.
    const keys = Object.keys(res.result);
    assert.ok(keys.indexOf("total") < keys.indexOf("items"));
    assert.ok(keys.indexOf("note") < keys.indexOf("items"));
    assert.equal(reqs.length, 1, "exactly one page fetched by default");
  });

  it("evidence library fetchAll merges every page (counts still first)", async () => {
    const { listEvidenceLibrary } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listEvidenceLibrary(undefined, { size: 50 }, { fetchAll: true });
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.total, 60);
    assert.equal(res.result.returned, 60);
    assert.equal(res.result.items.length, 60);
    assert.deepEqual(Object.keys(res.result), ["total", "returned", "items"]);
  });

  it("monitoring tests default returns one capped page with real total and a paging note", async () => {
    const { listMonitoringTestsV2 } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listMonitoringTestsV2();
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.returned, 50);
    assert.equal(res.result.total, 60);
    assert.match(res.result.note, /First page only/);
  });

  it("monitoring tests fetchAll still reports total === returned === tests.length", async () => {
    const { listMonitoringTestsV2 } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listMonitoringTestsV2(undefined, undefined, { fetchAll: true });
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.total, res.result.returned);
    assert.equal(res.result.total, res.result.tests.length);
    assert.equal(res.result.total, 60);
  });

  it("explicit cursor paging gets no default-page note", async () => {
    const { listMonitoringTestsV2 } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listMonitoringTestsV2(undefined, { cursor: "c-50", size: 10 });
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.note, undefined);
    assert.equal(res.result.returned, 10);
  });
});

// ──────────────────────────────────────────────────────────────
// list_framework_requirements: validated frameworkId + trimmed prose
// ──────────────────────────────────────────────────────────────
describe("list_framework_requirements", () => {
  it("rejects an unknown frameworkId with the available list", async () => {
    const { listFrameworkRequirements } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listFrameworkRequirements(undefined, { frameworkId: 999 });
    assert.equal(res.isError, true);
    assert.match(res.error, /No framework with id 999/);
    assert.match(res.error, /1 \(SOC_2\)/);
    assert.match(res.error, /2 \(ISO27001\)/);
  });

  it("filters client-side on the framework tag since upstream ignores frameworkId", async () => {
    const { listFrameworkRequirements } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listFrameworkRequirements(undefined, { frameworkId: 1 });
    assert.equal(res.isError, false, res.error);
    assert.deepEqual(
      res.result.requirements.map((r) => r.frameworkTag),
      ["SOC_2", "SOC_2"],
      "ISO27001 requirement must be filtered out",
    );
    assert.match(res.result.note, /ignored by the upstream endpoint/);
    assert.equal(
      res.result.total,
      null,
      "multi-framework tenant: upstream totalCount spans all frameworks",
    );
  });

  it("default call sends includeTotalCount and reports the real total", async () => {
    const { listFrameworkRequirements } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listFrameworkRequirements();
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.total, 3);
    const req = reqs.find((r) => r.path === "/public/v2/workspaces/1/framework-requirements");
    assert.match(req.query, /includeTotalCount=true/);
    assert.match(req.query, /size=20/);
  });

  it("trims additionalInfo* by default and restores it via fields ['*']", async () => {
    const { listFrameworkRequirements } = await import("../dist/handlers/v2-write.handler.js");
    const trimmed = await listFrameworkRequirements();
    assert.equal(trimmed.result.requirements[0].additionalInfo, undefined);
    assert.equal(trimmed.result.requirements[0].description, "d1", "light fields survive");

    const full = await listFrameworkRequirements(undefined, undefined, { fields: ["*"] });
    assert.equal(full.result.requirements[0].additionalInfo.length, 500);

    const projected = await listFrameworkRequirements(undefined, undefined, {
      fields: ["id", "name"],
    });
    assert.deepEqual(Object.keys(projected.result.requirements[0]), ["id", "name"]);
  });
});

// ──────────────────────────────────────────────────────────────
// list_user_assigned_policies: per-version row enrichment
// ──────────────────────────────────────────────────────────────
describe("list_user_assigned_policies enrichment", () => {
  it("annotates rows with currentVersion/policyName/policyStatus and counts real outstanding acks", async () => {
    const { listUserAssignedPolicies } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listUserAssignedPolicies(1);
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.total, 4);
    // Only row 304 (current version of an ACTIVE policy, acceptedAt null)
    // is genuinely outstanding; rows 302 (superseded version) and 303
    // (REPLACED policy) must not be counted.
    assert.equal(res.result.unacknowledgedCurrent, 1);
    assert.equal(res.result.supersededUnaccepted, 2);
    assert.match(res.result.semanticsNote, /per policy-VERSION/);

    const byId = new Map(res.result.assignedPolicies.map((r) => [r.id, r]));
    assert.equal(byId.get(301).currentVersion, true);
    assert.equal(byId.get(301).policyName, "Physical Security Policy");
    assert.equal(byId.get(302).currentVersion, false, "superseded version flagged");
    assert.equal(byId.get(303).policyStatus, "REPLACED");
    assert.equal(byId.get(304).currentVersion, true);

    // Counts and note precede the rows array.
    const keys = Object.keys(res.result);
    assert.ok(keys.indexOf("unacknowledgedCurrent") < keys.indexOf("assignedPolicies"));
    assert.ok(keys.indexOf("semanticsNote") < keys.indexOf("assignedPolicies"));
  });
});

// ──────────────────────────────────────────────────────────────
// list_upcoming_tasks: overdue included
// ──────────────────────────────────────────────────────────────
describe("list_upcoming_tasks overdue semantics", () => {
  it("no longer injects dueDateFrom=today, keeps INCOMPLETE + dueDate sort, and says so", async () => {
    const { listUpcomingTasks } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listUpcomingTasks(undefined);
    assert.equal(res.isError, false, res.error);
    const req = reqs.find((r) => r.path === "/public/v2/workspaces/1/tasks");
    assert.match(req.query, /status=INCOMPLETE/);
    assert.match(req.query, /sort=dueDate/);
    assert.match(req.query, /sortDir=ASC/);
    assert.doesNotMatch(req.query, /dueDateFrom/, "overdue tasks must not be excluded by default");
    assert.match(res.result.note, /OVERDUE/);
  });

  it("forwards an explicit dueDateFrom and drops the note", async () => {
    const { listUpcomingTasks } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listUpcomingTasks(undefined, { dueDateFrom: "2026-07-30" });
    const req = reqs.find((r) => r.path === "/public/v2/workspaces/1/tasks");
    assert.match(req.query, /dueDateFrom=2026-07-30/);
    assert.equal(res.result.note, undefined);
  });
});

// ──────────────────────────────────────────────────────────────
// list_events_v2: loud rejection of unparsable `since`
// ──────────────────────────────────────────────────────────────
describe("list_events_v2 since validation", () => {
  it("errors loudly on an unparsable since instead of returning unfiltered events", async () => {
    const { listEventsV2 } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listEventsV2({ createdAtFrom: "not-a-date" });
    assert.equal(res.isError, true);
    assert.match(res.error, /Unparsable/);
    assert.match(res.error, /not-a-date/);
    assert.equal(reqs.length, 0, "must not hit the API at all");
  });

  it("still client-side filters on a valid since", async () => {
    const { listEventsV2 } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listEventsV2({ createdAtFrom: "2026-07-01T00:00:00Z" });
    assert.equal(res.isError, false, res.error);
    assert.deepEqual(res.result.events.map((e) => e.id), ["e1"]);
  });
});

// ──────────────────────────────────────────────────────────────
// Silent-empty guards on per-parent lists
// ──────────────────────────────────────────────────────────────
describe("silent-empty guards", () => {
  it("list_policy_versions empty result points at get_policy", async () => {
    const { listPolicyVersions } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listPolicyVersions(999999);
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.total, 0);
    assert.match(res.result.note, /nonexistent policyIds too/);
    assert.match(res.result.note, /get_policy/);
    assert.equal(Object.keys(res.result)[0], "note", "note leads the payload");
  });

  it("list_policy_versions non-empty result carries no guard note", async () => {
    const { listPolicyVersions } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listPolicyVersions(101);
    assert.equal(res.result.total, 2);
    assert.equal(res.result.note, undefined);
  });

  it("list_vendor_questionnaires empty result points at get_vendor", async () => {
    const { listVendorQuestionnaires } = await import("../dist/handlers/v2-write.handler.js");
    const empty = await listVendorQuestionnaires(999999);
    assert.match(empty.result.note, /get_vendor/);
    const nonEmpty = await listVendorQuestionnaires(9);
    assert.equal(nonEmpty.result.note, undefined);
    assert.equal(nonEmpty.result.total, 1);
  });

  it("list_user_documents_v2 empty result warns about the userId/personnelId overlap", async () => {
    const { listUserDocuments } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listUserDocuments(999999);
    assert.match(res.result.note, /get_user/);
    assert.match(res.result.note, /not the personnel id/);
  });

  it("list_vendor_documents_v2 empty result points at get_vendor", async () => {
    const { listEntityDocuments } = await import("../dist/handlers/v2-write.handler.js");
    const res = await listEntityDocuments("vendors", 999999);
    assert.match(res.result.note, /get_vendor/);
  });

  it("list_risk_notes empty result explains the internal-id namespace and points at get_risk", async () => {
    const { listRiskNotes } = await import("../dist/handlers/v2-write.handler.js");
    const empty = await listRiskNotes(1, 22);
    assert.match(empty.result.note, /INTERNAL numeric id/);
    assert.match(empty.result.note, /get_risk/);
    const nonEmpty = await listRiskNotes(1, 47);
    assert.equal(nonEmpty.result.note, undefined);
    assert.equal(nonEmpty.result.total, 1);
  });

  it("get_control_requirement_comparison flags all-empty rows as possible bad ids", async () => {
    const { LibraryDeviceReadTools } = await import(
      "../dist/tools/v2/library-device-reads.tools.js"
    );
    const tool = LibraryDeviceReadTools.find(
      (candidate) => candidate().name === "get_control_requirement_comparison",
    )();
    const result = await tool.handler({ controlIds: [999999, 61] });
    const payload = JSON.parse(result.content[0].text);
    assert.match(payload.note, /999999/);
    assert.match(payload.note, /NONEXISTENT/);
    assert.match(payload.note, /get_control/);
    assert.equal(payload.data.length, 2, "rows still returned untouched");
  });
});

// ──────────────────────────────────────────────────────────────
// get_policy_version_content: self-identifying output
// ──────────────────────────────────────────────────────────────
describe("get_policy_version_content metadata", () => {
  it("handler enriches with policy name/status, version status, and contentChars — html last", async () => {
    const { getPolicyVersionContent } = await import("../dist/handlers/v2-write.handler.js");
    const res = await getPolicyVersionContent(101, 201);
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.policyName, "Physical Security Policy");
    assert.equal(res.result.policyStatus, "ACTIVE", "numeric policyStatus decoded");
    assert.equal(res.result.policyVersionStatus, "PUBLISHED");
    assert.equal(res.result.currentVersion, true);
    assert.equal(res.result.contentChars, POLICY_VERSION_HTML.length);
    assert.equal(res.result.html, POLICY_VERSION_HTML);
    const keys = Object.keys(res.result);
    assert.equal(keys[keys.length - 1], "html", "html serializes last");
  });

  it("tool emits the metadata block before the HTML block", async () => {
    const { default: toolFactory } = await import(
      "../dist/tools/v2/get-policy-version-content.tool.js"
    );
    const tool = toolFactory();
    const result = await tool.handler({ policyId: 101, policyVersionId: 201 });
    assert.equal(result.content.length, 2);
    const metadata = JSON.parse(result.content[0].text);
    assert.equal(metadata.policyName, "Physical Security Policy");
    assert.equal(metadata.html, undefined, "html lives in its own block");
    assert.equal(result.content[1].text, POLICY_VERSION_HTML);
  });
});

// ──────────────────────────────────────────────────────────────
// list_risks: schema enums match the live API
// ──────────────────────────────────────────────────────────────
describe("list_risks filter enums", () => {
  it("status and treatmentPlan zod enums carry the values the EU API accepts", async () => {
    const { RiskOperationsTools } = await import(
      "../dist/tools/v2/risk-operations.tools.js"
    );
    const tool = RiskOperationsTools.find(
      (candidate) => candidate().name === "list_risks",
    )();
    const unwrap = (schema) =>
      typeof schema.unwrap === "function" ? schema.unwrap() : schema._def.innerType;
    assert.deepEqual(unwrap(tool.schema.status).options, [
      "ACTIVE",
      "ARCHIVED",
      "CLOSED",
    ]);
    assert.deepEqual(unwrap(tool.schema.treatmentPlan).options, [
      "UNTREATED",
      "ACCEPT",
      "TRANSFER",
      "AVOID",
      "MITIGATE",
    ]);
  });

  it("get_risk_insights description warns about Risk Management Pro gating", async () => {
    const { RiskOperationsTools } = await import(
      "../dist/tools/v2/risk-operations.tools.js"
    );
    const tool = RiskOperationsTools.find(
      (candidate) => candidate().name === "get_risk_insights",
    )();
    assert.match(tool.description, /Risk Management Pro/);
    assert.match(tool.description, /402/);
  });
});

// ──────────────────────────────────────────────────────────────
// Schema/description accuracy spot-checks
// ──────────────────────────────────────────────────────────────
describe("schema and description accuracy", () => {
  it("list_vendor_documents_v2 marks vendorId required and keeps the loud runtime guard", async () => {
    const { OperationalCoverageTools } = await import(
      "../dist/tools/v2/operational-coverage.tools.js"
    );
    const tool = OperationalCoverageTools.find(
      (candidate) => candidate().name === "list_vendor_documents_v2",
    )();
    assert.equal(tool.schema.vendorId.isOptional(), false, "vendorId must be schema-required");
    const result = await tool.handler({});
    assert.match(result.content[0].text, /vendorId is required/);
  });

  it("get_user warns about the overlapping userId/personnelId namespaces", async () => {
    const { OperationalCoverageTools } = await import(
      "../dist/tools/v2/operational-coverage.tools.js"
    );
    const tool = OperationalCoverageTools.find(
      (candidate) => candidate().name === "get_user",
    )();
    assert.match(tool.description, /personnel/i);
    assert.match(tool.description, /overlap/i);
  });

  it("list_users notes the Public API Key pseudo-users", async () => {
    const { OperationalCoverageTools } = await import(
      "../dist/tools/v2/operational-coverage.tools.js"
    );
    const tool = OperationalCoverageTools.find(
      (candidate) => candidate().name === "list_users",
    )();
    assert.match(tool.description, /Public API Key/i);
  });

  it("get_policy description carries the approvedAt and expand=controls caveats", async () => {
    const { default: toolFactory } = await import("../dist/tools/v2/get-policy.tool.js");
    const tool = toolFactory();
    assert.match(tool.description, /approvedAt/);
    assert.match(tool.description, /CURRENT version/);
    assert.match(tool.description, /%s/);
  });

  it("list_upcoming_tasks description states overdue tasks are included", async () => {
    const { TaskOperationsTools } = await import(
      "../dist/tools/v2/task-operations.tools.js"
    );
    const tool = TaskOperationsTools.find(
      (candidate) => candidate().name === "list_upcoming_tasks",
    )();
    assert.match(tool.description, /overdue/i);
  });
});
