/**
 * Offline tests for the read-expansion tools (audits, vendor security-review
 * reads, questionnaire reads, policy approval-configuration) and for the
 * vendor security-review local-state retirement behaviors.
 *
 * Mock node:http server pattern copied from test/api-coverage.test.js:
 * capture every request's method/url/body, assert query serialization and
 * response shaping against the dist build.
 *
 * Run: node --test test/read-expansion-vendor.test.js
 */
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";

let server;
let baseUrl;
let requests;

// Mutable fixtures the retirement tests tweak per-case.
let vendorFixtures;

const VENDOR_42 = {
  id: 42,
  name: "Acme SaaS",
  critical: true,
  risk: "HIGH",
  impactLevel: "MAJOR",
  hasPii: false,
};
const VENDOR_43_LIST_BROKEN = {
  id: 43,
  name: "Failing Vendor",
  critical: false,
  risk: "LOW",
  impactLevel: "MINOR",
  hasPii: false,
};
const VENDOR_44_SHELL_ONLY = {
  id: 44,
  name: "Shell Only Vendor",
  critical: false,
  risk: "LOW",
  impactLevel: "MINOR",
  hasPii: false,
};

const EMPTY_STATE_PATH = `/tmp/drata-read-expansion-no-state-${process.pid}.json`;
const SEEDED_STATE_PATH = `/tmp/drata-read-expansion-seeded-state-${process.pid}.json`;

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function json(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(data));
}

before(async () => {
  requests = [];
  vendorFixtures = [VENDOR_42];
  server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    requests.push({
      method: req.method,
      url: req.url,
      body,
      contentType: req.headers["content-type"],
    });
    const path = req.url.split("?")[0];

    // ── Audits ──
    if (req.method === "GET" && path === "/public/v2/workspaces/1/audits") {
      if (req.url.includes("cursor=")) {
        return json(res, {
          data: [{ id: "audit-2", name: "ISO 27001" }],
          pagination: { cursor: "next-page", totalCount: 5 },
        });
      }
      return json(res, {
        data: [
          { id: "audit-1", name: "SOC 2 Type II" },
          { id: "audit-2", name: "ISO 27001" },
        ],
        pagination: { cursor: null },
      });
    }
    if (
      req.method === "GET" &&
      path === "/public/v2/workspaces/1/audits/audit-1"
    ) {
      return json(res, { id: "audit-1", name: "SOC 2 Type II" });
    }

    // ── Vendor security reviews ──
    if (
      req.method === "GET" &&
      path === "/public/v2/vendors/42/security-reviews"
    ) {
      if (req.url.includes("size=1")) {
        return json(res, {
          data: [
            {
              id: 11,
              securityReviewType: "SOC_REPORT",
              status: "COMPLETED",
              decision: "APPROVED",
            },
          ],
          pagination: { cursor: "next-reviews", totalCount: 5 },
        });
      }
      return json(res, {
        data: [
          {
            id: 11,
            securityReviewType: "SOC_REPORT",
            status: "COMPLETED",
            decision: "APPROVED",
          },
          {
            id: 12,
            securityReviewType: "SECURITY",
            status: "COMPLETED",
            decision: "APPROVED",
          },
        ],
        pagination: { cursor: null },
      });
    }
    if (
      req.method === "GET" &&
      path === "/public/v2/vendors/44/security-reviews"
    ) {
      // A scheduled shell: the Drata app renders this vendor as
      // "No past review" even though a review record exists.
      return json(res, {
        data: [{ id: 99, status: "NOT_YET_STARTED", decision: "PENDING" }],
        pagination: { cursor: null },
      });
    }
    if (
      req.method === "GET" &&
      path === "/public/v2/vendors/43/security-reviews"
    ) {
      return json(res, { statusCode: 500, message: "boom", code: 10010 }, 500);
    }
    if (
      req.method === "GET" &&
      path === "/public/v2/vendors/42/security-reviews/99"
    ) {
      return json(res, { id: 99, vendorId: 42, securityReviewStatus: "COMPLETED" });
    }
    if (
      req.method === "POST" &&
      path === "/public/v2/vendors/42/security-reviews"
    ) {
      return json(res, { id: 600, vendorId: 42 });
    }
    if (
      req.method === "POST" &&
      path === "/public/v2/vendors/42/security-reviews/with-file"
    ) {
      return json(res, { id: 601, vendorId: 42, fileReceived: true });
    }
    if (
      req.method === "GET" &&
      path === "/public/v2/vendors/42/security-reviews/9/actions"
    ) {
      return json(res, {
        data: [{ type: "FINALIZE" }],
        pagination: { cursor: null },
      });
    }
    if (
      req.method === "GET" &&
      path === "/public/v2/vendors/42/security-reviews/9/security-questionnaires"
    ) {
      return json(res, {
        data: [{ id: 3, name: "SIG Lite" }],
        pagination: { cursor: null },
      });
    }

    // ── Vendor questionnaires ──
    if (req.method === "GET" && path === "/public/v2/vendors/42/questionnaires/5") {
      return json(res, { id: 5, status: "COMPLETED", sentAt: "2026-06-01T00:00:00Z" });
    }
    if (req.method === "GET" && path === "/public/questionnaires/5/vendor/42") {
      return json(res, {
        questionnaireId: 5,
        vendorId: 42,
        answers: [{ question: "Do you encrypt data at rest?", answer: "Yes" }],
      });
    }

    // ── Policies ──
    if (
      req.method === "GET" &&
      path === "/public/v2/policies/7/approval-configuration"
    ) {
      return json(res, {
        policyId: 7,
        approvalTiers: [{ tier: 1, reviewGroupIds: [5] }],
      });
    }

    // ── Vendor lists for the retirement (check_*) handlers ──
    if (req.method === "GET" && path === "/public/vendors") {
      return json(res, {
        data: vendorFixtures,
        page: 1,
        limit: 50,
        total: vendorFixtures.length,
      });
    }
    if (req.method === "GET" && path === "/public/v2/vendors") {
      return json(res, { data: vendorFixtures, pagination: { cursor: null } });
    }
    if (req.method === "GET" && path === "/public/v2/events") {
      return json(res, {
        data: [
          {
            id: "evt-43",
            type: "VENDOR_SECURITY_REVIEW_STARTED",
            description: "Security review started for Failing Vendor",
            metadata: { vendorId: 43 },
          },
        ],
        pagination: { cursor: null },
      });
    }

    return json(res, { data: [], pagination: { cursor: null }, ok: true });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  process.env.DRATA_API_KEY = "test-key";
  process.env.DRATA_BASE_URL = baseUrl;
  process.env.DRATA_WORKSPACE_ID = "1";
  // Never let these tests touch a real state file in $HOME.
  process.env.DRATA_MCP_STATE_PATH = EMPTY_STATE_PATH;
});

beforeEach(() => {
  requests.length = 0;
  vendorFixtures = [VENDOR_42];
  process.env.DRATA_MCP_STATE_PATH = EMPTY_STATE_PATH;
  for (const file of [EMPTY_STATE_PATH, SEEDED_STATE_PATH]) {
    try {
      unlinkSync(file);
    } catch {
      /* already absent */
    }
  }
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const file of [EMPTY_STATE_PATH, SEEDED_STATE_PATH]) {
    try {
      unlinkSync(file);
    } catch {
      /* already absent */
    }
  }
});

async function getTool(name) {
  const { AuditRequestTools } = await import("../dist/tools/v2/audit-request.tools.js");
  const { VendorSecurityReviewReadTools } = await import(
    "../dist/tools/v2/get-vendor-security-review.tool.js"
  );
  const { GetPolicyApprovalConfigurationTool } = await import(
    "../dist/tools/v2/get-policy.tool.js"
  );
  const factory = [
    ...AuditRequestTools,
    ...VendorSecurityReviewReadTools,
    GetPolicyApprovalConfigurationTool,
  ].find((candidate) => candidate().name === name);
  assert.ok(factory, `tool ${name} not found`);
  return factory();
}

describe("audit discovery reads", () => {
  it("list_audits walks every page and wraps the merged envelope", async () => {
    const tool = await getTool("list_audits");
    const result = await tool.handler({});

    assert.equal(result.content[0].type, "text");
    assert.equal(requests[0].method, "GET");
    assert.equal(requests[0].url, "/public/v2/workspaces/1/audits");
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.returned, 2);
    assert.equal(parsed.total, 2);
    assert.deepEqual(
      parsed.audits.map((a) => a.id),
      ["audit-1", "audit-2"],
    );
  });

  it("list_audits explicit page passes cursor/sort/expand and keeps pagination", async () => {
    const tool = await getTool("list_audits");
    const result = await tool.handler({
      cursor: "c1",
      size: 10,
      sort: "createdAt",
      sortDir: "DESC",
      expand: ["auditors", "internalAuditors"],
    });

    assert.equal(requests.length, 1, "explicit page must be a single GET");
    assert.match(requests[0].url, /^\/public\/v2\/workspaces\/1\/audits\?/);
    assert.match(requests[0].url, /cursor=c1/);
    assert.match(requests[0].url, /size=10/);
    assert.match(requests[0].url, /sort=createdAt/);
    assert.match(requests[0].url, /sortDir=DESC/);
    assert.match(requests[0].url, /expand=auditors/);
    assert.match(requests[0].url, /expand=internalAuditors/);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.returned, 1);
    assert.equal(
      parsed.total,
      5,
      "total comes from Drata's pagination.totalCount when present",
    );
    assert.equal(parsed.pagination.cursor, "next-page");
  });

  it("list_audits has no includeTotalCount param (absent from Drata's spec)", async () => {
    const tool = await getTool("list_audits");
    assert.equal(tool.schema.includeTotalCount, undefined);
    assert.deepEqual(tool.annotations, { readOnlyHint: true, idempotentHint: true });
  });

  it("get_audit returns the raw audit and serializes expand", async () => {
    const tool = await getTool("get_audit");
    const result = await tool.handler({ auditId: "audit-1", expand: ["controls"] });

    assert.equal(requests[0].method, "GET");
    assert.match(
      requests[0].url,
      /^\/public\/v2\/workspaces\/1\/audits\/audit-1\?expand=controls$/,
    );
    const parsed = JSON.parse(result.content[0].text);
    assert.deepEqual(parsed, { id: "audit-1", name: "SOC 2 Type II" });
  });
});

describe("vendor security-review reads", () => {
  it("list_vendor_security_reviews serializes status[]/type[]/decision[] bracket keys", async () => {
    const tool = await getTool("list_vendor_security_reviews");
    const result = await tool.handler({
      vendorId: 42,
      statuses: ["IN_PROGRESS", "COMPLETED"],
      types: ["SOC_REPORT"],
      decisions: ["APPROVED"],
      expand: ["user"],
    });

    assert.equal(requests[0].method, "GET");
    assert.match(requests[0].url, /^\/public\/v2\/vendors\/42\/security-reviews\?/);
    assert.match(requests[0].url, /status%5B%5D=IN_PROGRESS/);
    assert.match(requests[0].url, /status%5B%5D=COMPLETED/);
    assert.match(requests[0].url, /type%5B%5D=SOC_REPORT/);
    assert.match(requests[0].url, /decision%5B%5D=APPROVED/);
    assert.match(requests[0].url, /expand=user/);
    assert.doesNotMatch(requests[0].url, /(^|[?&])status=/);
    assert.doesNotMatch(requests[0].url, /(^|[?&])type=/);
    assert.doesNotMatch(requests[0].url, /(^|[?&])decision=/);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.returned, 2);
    assert.equal(parsed.total, 2);
    assert.deepEqual(
      parsed.securityReviews.map((r) => r.id),
      [11, 12],
    );
  });

  it("list_vendor_security_reviews explicit page keeps the wrapV2List envelope", async () => {
    const tool = await getTool("list_vendor_security_reviews");
    const result = await tool.handler({
      vendorId: 42,
      size: 1,
      includeTotalCount: true,
    });

    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /size=1/);
    assert.match(requests[0].url, /includeTotalCount=true/);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.returned, 1);
    // total now surfaces Drata's pagination.totalCount when present.
    assert.equal(parsed.total, 5);
    assert.equal(parsed.pagination.cursor, "next-reviews");
    assert.equal(parsed.pagination.totalCount, 5);
  });

  it("list_security_review_actions hits the actions route and wraps actions", async () => {
    const tool = await getTool("list_security_review_actions");
    assert.match(tool.description, /🧪 beta/);
    const result = await tool.handler({ vendorId: 42, securityReviewId: 9 });

    assert.equal(requests[0].method, "GET");
    assert.match(
      requests[0].url,
      /^\/public\/v2\/vendors\/42\/security-reviews\/9\/actions/,
    );
    const parsed = JSON.parse(result.content[0].text);
    assert.deepEqual(parsed.actions, [{ type: "FINALIZE" }]);
    assert.equal(parsed.returned, 1);
  });

  it("list_security_review_questionnaires hits the review-scoped route", async () => {
    const tool = await getTool("list_security_review_questionnaires");
    assert.match(tool.description, /🧪 beta/);
    const result = await tool.handler({
      vendorId: 42,
      securityReviewId: 9,
      size: 5,
    });

    assert.equal(requests[0].method, "GET");
    assert.match(
      requests[0].url,
      /^\/public\/v2\/vendors\/42\/security-reviews\/9\/security-questionnaires\?/,
    );
    assert.match(requests[0].url, /size=5/);
    const parsed = JSON.parse(result.content[0].text);
    assert.deepEqual(parsed.questionnaires, [{ id: 3, name: "SIG Lite" }]);
    assert.equal(parsed.returned, 1);
  });

  it("get_vendor_questionnaire uses the V2 vendor-scoped path", async () => {
    const tool = await getTool("get_vendor_questionnaire");
    const result = await tool.handler({ vendorId: 42, questionnaireId: 5 });

    assert.equal(requests[0].method, "GET");
    assert.equal(requests[0].url, "/public/v2/vendors/42/questionnaires/5");
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.id, 5);
    assert.equal(parsed.status, "COMPLETED");
  });

  it("get_vendor_questionnaire_answers uses the reversed V1 segment order", async () => {
    const tool = await getTool("get_vendor_questionnaire_answers");
    const result = await tool.handler({ vendorId: 42, questionnaireId: 5 });

    assert.equal(requests[0].method, "GET");
    // Easy to transpose: it is /questionnaires/{qid}/vendor/{vid}, NOT
    // /vendors/{vid}/questionnaires/{qid}.
    assert.equal(requests[0].url, "/public/questionnaires/5/vendor/42");
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.answers.length, 1);
    assert.equal(parsed.answers[0].answer, "Yes");
  });
});

describe("policy approval-configuration read", () => {
  it("get_policy_approval_configuration returns the raw configuration", async () => {
    const tool = await getTool("get_policy_approval_configuration");
    const result = await tool.handler({ policyId: 7 });

    assert.equal(requests[0].method, "GET");
    assert.equal(requests[0].url, "/public/v2/policies/7/approval-configuration");
    const parsed = JSON.parse(result.content[0].text);
    assert.deepEqual(parsed.approvalTiers, [{ tier: 1, reviewGroupIds: [5] }]);
  });
});

describe("registration and annotations", () => {
  it("registers every new read tool in V2Tools with read-only annotations", async () => {
    const { V2Tools } = await import("../dist/tools/v2/index.js");
    const byName = new Map(V2Tools.map((factory) => [factory().name, factory()]));
    const newTools = [
      "list_audits",
      "get_audit",
      "list_vendor_security_reviews",
      "list_security_review_actions",
      "list_security_review_questionnaires",
      "get_vendor_questionnaire",
      "get_vendor_questionnaire_answers",
      "get_policy_approval_configuration",
    ];
    for (const name of newTools) {
      const tool = byName.get(name);
      assert.ok(tool, `${name} must be registered in V2Tools`);
      assert.equal(tool.annotations?.readOnlyHint, true, `${name} readOnlyHint`);
      assert.equal(tool.annotations?.idempotentHint, true, `${name} idempotentHint`);
    }
  });
});

describe("review ID dedup: expand + api_list overlap", () => {
  it("merges overlapping expand and list reviews without duplicating IDs", async () => {
    // The V2 vendors route returns the vendor WITH its reviews expanded, and
    // the per-vendor security-reviews list route (already mocked above for
    // vendor 42) returns the very same two COMPLETED reviews. Regression: the
    // api_list merge used to push [11, 12] again on top of the expand-sourced
    // records.
    vendorFixtures = [
      {
        ...VENDOR_42,
        reviews: [
          {
            id: 11,
            securityReviewType: "SOC_REPORT",
            status: "COMPLETED",
            decision: "APPROVED",
          },
          {
            id: 12,
            securityReviewType: "SECURITY",
            status: "COMPLETED",
            decision: "APPROVED",
          },
        ],
      },
    ];
    const { checkVendorSecurityReviews } = await import(
      "../dist/handlers/check-vendor-security-reviews.handler.js"
    );

    const result = await checkVendorSecurityReviews({ fields: ["reviews"] });

    assert.equal(result.isError, false);
    const acme = result.result.hasReviews.find((v) => v.id === 42);
    assert.ok(acme, "vendor with overlapping COMPLETED reviews must land in hasReviews");
    assert.deepEqual(
      acme.reviews.map((r) => r.id),
      [11, 12],
      "no duplicate review IDs",
    );
    assert.equal(acme.totalReviewRecords, 2, "overlap must not inflate the record count");
    assert.equal(acme.reviews.length, 2);
    assert.equal(acme.completedReviewCount, 2);
    assert.equal(acme.pendingReviewCount, 0);
    assert.equal(acme.securityReviewStatus, "UP_TO_DATE");
    assert.ok(
      acme.reviewSources.includes("api_expand"),
      `expected api_expand in ${JSON.stringify(acme.reviewSources)}`,
    );
    assert.ok(
      acme.reviewSources.includes("api_list"),
      `expected api_list in ${JSON.stringify(acme.reviewSources)}`,
    );
    assert.ok(
      requests.find((r) =>
        r.url.startsWith("/public/v2/vendors/42/security-reviews"),
      ),
      "the official per-vendor list endpoint must still be queried",
    );
  });
});

describe("scheduled shell reviews stay NO_PAST_REVIEW", () => {
  it("a vendor whose only review is a NOT_YET_STARTED shell stays in needsReview", async () => {
    // Matches the Drata app: a scheduled NOT_YET_STARTED/PENDING record is a
    // shell, not a past review, so the vendor renders as "No past review".
    vendorFixtures = [VENDOR_42, VENDOR_44_SHELL_ONLY];
    const { checkVendorSecurityReviews } = await import(
      "../dist/handlers/check-vendor-security-reviews.handler.js"
    );

    const result = await checkVendorSecurityReviews({ fields: ["reviews"] });

    assert.equal(result.isError, false);
    assert.equal(
      result.result.vendorsWithReviews,
      1,
      "only Acme (COMPLETED reviews) may count as having reviews",
    );
    assert.equal(
      result.result.hasReviews.find((v) => v.id === 44),
      undefined,
      "a shell-only vendor must never land in hasReviews",
    );
    const shellVendor = result.result.needsReview.find((v) => v.id === 44);
    assert.ok(shellVendor, "shell-only vendor must stay in needsReview");
    assert.equal(shellVendor.securityReviewStatus, "NO_PAST_REVIEW");
    assert.equal(shellVendor.pendingReviewCount, 1);
    assert.equal(shellVendor.completedReviewCount, 0);
    assert.equal(shellVendor.totalReviewRecords, 1);
    assert.deepEqual(shellVendor.reviews, [
      { id: 99, status: "NOT_YET_STARTED", decision: "PENDING", title: null },
    ]);
    assert.equal(result.result.vendorsWithPendingShellsOnly, 1);
  });
});

describe("vendor security-review local-state retirement", () => {
  it("check_vendor_risk reports api_list as the primary source with no state file", async () => {
    const { checkVendors } = await import("../dist/handlers/check-vendors.handler.js");

    const result = await checkVendors();

    assert.equal(result.isError, false);
    const acme = result.result.vendors.find((v) => v.id === 42);
    assert.deepEqual(acme.reviewSources, ["api_list"]);
    assert.deepEqual(acme.reviewIds, [11, 12]);
    // reviewCount split into completed/pending/unverifiable buckets.
    assert.equal(acme.completedReviewCount, 2);
    assert.equal(acme.pendingReviewCount, 0);
    assert.equal(acme.unverifiableReviewCount, 0);
    // Heuristics are demoted: a successful list call means no event-log scan.
    assert.equal(
      requests.find((r) => r.url.startsWith("/public/v2/events")),
      undefined,
      "event log must not be queried when the official list succeeds",
    );
  });

  it("list_vendor_security_review_statuses reports api_list without a state file", async () => {
    const { checkVendorSecurityReviews } = await import(
      "../dist/handlers/check-vendor-security-reviews.handler.js"
    );

    const result = await checkVendorSecurityReviews({ fields: ["reviews"] });

    assert.equal(result.isError, false);
    const acme = result.result.hasReviews.find((v) => v.id === 42);
    assert.ok(acme, "list-discovered COMPLETED reviews must move the vendor into hasReviews");
    assert.deepEqual(acme.reviewSources, ["api_list"]);
    assert.deepEqual(
      acme.reviews.map((r) => r.id),
      [11, 12],
    );
    assert.equal(acme.totalReviewRecords, 2);
    assert.equal(acme.completedReviewCount, 2);
    assert.match(result.result.sourceNote, /api_list/);
  });

  it("falls back to event-log heuristics only for vendors whose list call fails", async () => {
    vendorFixtures = [VENDOR_42, VENDOR_43_LIST_BROKEN];
    const { checkVendors } = await import("../dist/handlers/check-vendors.handler.js");

    const result = await checkVendors();

    assert.equal(result.isError, false);
    const failing = result.result.vendors.find((v) => v.id === 43);
    assert.deepEqual(failing.reviewSources, ["event_log"]);
    assert.deepEqual(failing.eventIds, ["evt-43"]);
    // Event-log detections have unknowable status: unverifiable, not
    // completed and not absent.
    assert.equal(failing.completedReviewCount, 0);
    assert.equal(failing.unverifiableReviewCount, 1);
    const acme = result.result.vendors.find((v) => v.id === 42);
    assert.deepEqual(acme.reviewSources, ["api_list"]);
    assert.ok(
      requests.find((r) => r.url.startsWith("/public/v2/events")),
      "event log must be queried when a list call fails",
    );
  });

  it("populated legacy state still contributes via GET-by-ID and warns exactly once", async () => {
    process.env.DRATA_MCP_STATE_PATH = SEEDED_STATE_PATH;
    writeFileSync(
      SEEDED_STATE_PATH,
      `${JSON.stringify({ vendorSecurityReviews: { 42: [99] } })}\n`,
    );
    const { checkVendors } = await import("../dist/handlers/check-vendors.handler.js");

    const stderrLines = [];
    const originalError = console.error;
    console.error = (...args) => {
      stderrLines.push(args.join(" "));
    };
    let result;
    try {
      result = await checkVendors();
      // Second run must not warn again — the nudge is once per process.
      await checkVendors();
    } finally {
      console.error = originalError;
    }

    assert.equal(result.isError, false);
    const acme = result.result.vendors.find((v) => v.id === 42);
    assert.deepEqual(acme.reviewIds, [11, 12, 99]);
    assert.ok(acme.reviewSources.includes("api_list"));
    assert.ok(acme.reviewSources.includes("persisted_get_by_id"));
    assert.ok(
      requests.find(
        (r) =>
          r.method === "GET" &&
          r.url.startsWith("/public/v2/vendors/42/security-reviews/99"),
      ),
      "remembered ID must be verified with GET-by-ID",
    );
    const deprecations = stderrLines.filter((line) => /DEPRECATED/.test(line));
    assert.equal(deprecations.length, 1, `expected one deprecation line, got: ${deprecations}`);
  });

  it("create_vendor_security_review no longer writes the local state file", async () => {
    const { createVendorSecurityReview } = await import(
      "../dist/handlers/v2-write.handler.js"
    );

    const result = await createVendorSecurityReview(42, {
      reviewDeadlineAt: "2026-07-01T00:00:00Z",
      securityReviewStatus: "IN_PROGRESS",
      securityReviewType: "SECURITY",
      requesterUserId: 1,
    });

    assert.equal(result.isError, false);
    assert.equal(result.result.id, 600);
    assert.equal(existsSync(EMPTY_STATE_PATH), false, "state file must not be created");
  });

  it("create_vendor_security_review_with_file no longer writes the local state file", async () => {
    const { createVendorSecurityReviewWithFile } = await import(
      "../dist/handlers/v2-write.handler.js"
    );

    const result = await createVendorSecurityReviewWithFile(
      42,
      new Uint8Array([1, 2, 3]),
      "soc.pdf",
      { title: "SOC 2 review" },
    );

    assert.equal(result.isError, false);
    assert.equal(result.result.id, 601);
    assert.equal(existsSync(EMPTY_STATE_PATH), false, "state file must not be created");
  });
});
