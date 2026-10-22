/**
 * Offline regression tests for vendor tool output accuracy:
 *  - get_vendor drops upstream's always-empty reviews/latestSecurityReviews
 *    and adds securityReviewsNote
 *  - search_vendors marks archived vendors
 *  - check_vendor_risk counts only COMPLETED reviews, marks archived vendors,
 *    and leads with aggregates
 *  - list_vendor_security_review_statuses compacts per-vendor entries with
 *    fields[] opt-in detail and marks archived vendors
 *  - list_security_review_actions describes support for every review type,
 *    not SOC_REPORT only
 *
 * Mock node:http server pattern copied from test/read-expansion-vendor.test.js.
 * Run: node --test test/fix-vendors.test.js
 */
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { unlinkSync } from "node:fs";

let server;
let requests;

const STATE_PATH = path.join(os.tmpdir(), `drata-fix-vendors-state-${process.pid}.json`);

const ACME = {
  id: 10,
  name: "Acme Insurance Ltd",
  critical: true,
  risk: "MODERATE",
  impactLevel: "MODERATE",
  hasPii: false,
  privacyUrl: "https://acme-insurance.example/privacy",
  termsUrl: null,
  passwordPolicy: "SSO",
  passwordMfaEnabled: true,
  status: null,
  archivedAt: null,
};
const ZED = {
  id: 20,
  name: "Zed Ltd",
  critical: false,
  risk: "LOW",
  impactLevel: "MINOR",
  hasPii: false,
  privacyUrl: null,
  termsUrl: null,
  passwordPolicy: null,
  passwordMfaEnabled: false,
  status: null,
  archivedAt: null,
};
const AWS_ARCHIVED = {
  id: 40,
  name: "AWS",
  critical: false,
  risk: "NONE",
  impactLevel: "UNSCORED",
  hasPii: false,
  privacyUrl: null,
  termsUrl: null,
  passwordPolicy: null,
  passwordMfaEnabled: false,
  status: "ARCHIVED",
  archivedAt: "2026-07-02T12:00:00.000Z",
};
const EVENT_ONLY = {
  id: 77,
  name: "Event Fallback Co",
  critical: false,
  risk: "LOW",
  impactLevel: "MINOR",
  hasPii: false,
  privacyUrl: null,
  termsUrl: null,
  passwordPolicy: null,
  passwordMfaEnabled: false,
  status: null,
  archivedAt: null,
};
const VENDORS = [ACME, ZED, AWS_ARCHIVED, EVENT_ONLY];

const ACME_REVIEWS = [
  {
    id: 53,
    status: "COMPLETED",
    decision: "PENDING",
    title: "2026 review",
    requestedAt: "2026-05-01T00:00:00Z",
    reviewDeadlineAt: null,
  },
  {
    id: 30,
    status: "NOT_YET_STARTED",
    decision: "PENDING",
    title: "Scheduled review",
    requestedAt: null,
    reviewDeadlineAt: "2026-12-01T00:00:00Z",
  },
];

function json(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(data));
}

before(async () => {
  requests = [];
  server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    const p = req.url.split("?")[0];

    if (req.method !== "GET") return json(res, { message: "read-only test" }, 500);

    if (p === "/public/vendors") {
      return json(res, { data: VENDORS, page: 1, limit: 50, total: VENDORS.length });
    }
    // Single-vendor GET: upstream never populates review data — mirror the
    // live API's always-empty arrays.
    if (p === "/public/vendors/41") {
      return json(res, {
        id: 41,
        name: "Example Legal LLP",
        risk: "MODERATE",
        reviews: [],
        latestSecurityReviews: [],
        archivedAt: null,
      });
    }
    // Hypothetical future upstream that DOES populate reviews.
    if (p === "/public/vendors/55") {
      return json(res, {
        id: 55,
        name: "Future Vendor",
        reviews: [{ id: 9, status: "COMPLETED" }],
        latestSecurityReviews: [],
      });
    }
    if (p === "/public/v2/vendors") {
      return json(res, { data: VENDORS, pagination: { cursor: null } });
    }
    if (p === "/public/v2/vendors/10/security-reviews") {
      return json(res, { data: ACME_REVIEWS, pagination: { cursor: null } });
    }
    if (p === "/public/v2/vendors/20/security-reviews" || p === "/public/v2/vendors/40/security-reviews") {
      return json(res, { data: [], pagination: { cursor: null } });
    }
    // Vendor 77's list call fails → event-log fallback path.
    if (p === "/public/v2/vendors/77/security-reviews") {
      return json(res, { statusCode: 500, message: "boom", code: 10010 }, 500);
    }
    if (p === "/public/v2/events") {
      return json(res, {
        data: [
          {
            id: "evt-77",
            type: "VENDOR_SECURITY_REVIEW_STARTED",
            description: "Security review started for Event Fallback Co",
            metadata: { vendorId: 77 },
          },
        ],
        pagination: { cursor: null },
      });
    }
    return json(res, { data: [], pagination: { cursor: null } });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.DRATA_API_KEY = "test-key";
  process.env.DRATA_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.DRATA_WORKSPACE_ID = "1";
  process.env.DRATA_MCP_STATE_PATH = STATE_PATH;
});

beforeEach(() => {
  requests.length = 0;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try {
    unlinkSync(STATE_PATH);
  } catch {
    /* already absent */
  }
});

describe("get_vendor review-data accuracy", () => {
  it("drops always-empty reviews/latestSecurityReviews and leads with securityReviewsNote", async () => {
    const { getVendor } = await import("../dist/handlers/vendor-read.handler.js");
    const res = await getVendor(41);

    assert.equal(res.isError, false);
    assert.equal("reviews" in res.result, false, "always-empty reviews key must be removed");
    assert.equal(
      "latestSecurityReviews" in res.result,
      false,
      "always-empty latestSecurityReviews key must be removed",
    );
    assert.match(res.result.securityReviewsNote, /list_vendor_security_reviews/);
    assert.match(res.result.securityReviewsNote, /no security-review data/i);
    assert.equal(
      Object.keys(res.result)[0],
      "securityReviewsNote",
      "note must lead the payload so truncation cannot cut it",
    );
    assert.equal(res.result.id, 41);
    assert.equal(res.result.name, "Example Legal LLP");
  });

  it("passes non-empty review arrays through if upstream ever populates them", async () => {
    const { getVendor } = await import("../dist/handlers/vendor-read.handler.js");
    const res = await getVendor(55);

    assert.equal(res.isError, false);
    assert.deepEqual(res.result.reviews, [{ id: 9, status: "COMPLETED" }]);
    assert.equal("latestSecurityReviews" in res.result, false);
  });
});

describe("search_vendors archived marker", () => {
  it("marks archived vendors and counts them ahead of the array", async () => {
    const { searchVendors } = await import("../dist/handlers/vendor-read.handler.js");
    const res = await searchVendors("aws");

    assert.equal(res.isError, false);
    assert.deepEqual(Object.keys(res.result), ["total", "archivedMatches", "vendors"]);
    assert.equal(res.result.total, 1);
    assert.equal(res.result.archivedMatches, 1);
    assert.equal(res.result.vendors[0].archived, true);
    assert.equal(res.result.vendors[0].archivedAt, "2026-07-02T12:00:00.000Z");
  });

  it("active vendors carry archived: false", async () => {
    const { searchVendors } = await import("../dist/handlers/vendor-read.handler.js");
    const res = await searchVendors("acme");

    assert.equal(res.result.total, 1);
    assert.equal(res.result.archivedMatches, 0);
    assert.equal(res.result.vendors[0].archived, false);
    assert.equal(res.result.vendors[0].archivedAt, null);
  });
});

describe("check_vendor_risk completed-only counts and archived marking", () => {
  it("splits review counts by status instead of counting shells as reviews", async () => {
    const { checkVendors } = await import("../dist/handlers/check-vendors.handler.js");
    const res = await checkVendors();

    assert.equal(res.isError, false);
    const acme = res.result.vendors.find((v) => v.id === 10);
    assert.equal(acme.completedReviewCount, 1, "only the COMPLETED review counts");
    assert.equal(acme.pendingReviewCount, 1, "the NOT_YET_STARTED shell is pending");
    assert.equal(acme.unverifiableReviewCount, 0);
    assert.equal(acme.reviewCount, undefined, "ambiguous reviewCount key was removed");
    assert.deepEqual(acme.reviewIds, [30, 53]);
  });

  it("marks archived vendors and excludes them from active aggregates", async () => {
    const { checkVendors } = await import("../dist/handlers/check-vendors.handler.js");
    const res = await checkVendors();

    assert.equal(res.result.totalVendors, 4);
    assert.equal(res.result.activeVendors, 3);
    assert.equal(res.result.archivedVendorsIncluded, 1);
    // Zed only: AWS is archived, Acme has a completed review, 77 is unknown.
    assert.equal(res.result.activeVendorsWithoutCompletedReview, 1);
    assert.equal(res.result.criticalActiveVendorsWithoutCompletedReview, 0);
    assert.equal(res.result.activeVendorsWithUnknownReviewStatus, 1);

    const aws = res.result.vendors.find((v) => v.id === 40);
    assert.equal(aws.archived, true);
    assert.equal(aws.archivedAt, "2026-07-02T12:00:00.000Z");
    const zed = res.result.vendors.find((v) => v.id === 20);
    assert.equal(zed.archived, false);
  });

  it("fallback-only detections are unverifiable, not completed", async () => {
    const { checkVendors } = await import("../dist/handlers/check-vendors.handler.js");
    const res = await checkVendors();

    const eventOnly = res.result.vendors.find((v) => v.id === 77);
    assert.equal(eventOnly.completedReviewCount, 0);
    assert.equal(eventOnly.unverifiableReviewCount, 1);
    assert.deepEqual(eventOnly.reviewSources, ["event_log"]);
    assert.deepEqual(eventOnly.eventIds, ["evt-77"]);
  });

  it("aggregates and notes precede the vendors array", async () => {
    const { checkVendors } = await import("../dist/handlers/check-vendors.handler.js");
    const res = await checkVendors();

    const keys = Object.keys(res.result);
    assert.equal(keys[0], "totalVendors");
    assert.equal(keys[keys.length - 1], "vendors");
    assert.ok(keys.indexOf("semanticsNote") < keys.indexOf("vendors"));
    assert.match(res.result.semanticsNote, /COMPLETED/);
  });
});

describe("list_vendor_security_review_statuses compaction", () => {
  it("default entries are compact: counts and decision, no nested review detail", async () => {
    const { checkVendorSecurityReviews } = await import(
      "../dist/handlers/check-vendor-security-reviews.handler.js"
    );
    const res = await checkVendorSecurityReviews();

    assert.equal(res.isError, false);
    const acme = res.result.hasReviews.find((v) => v.id === 10);
    assert.ok(acme, "Acme has a COMPLETED review so it belongs in hasReviews");
    assert.equal(acme.securityReviewStatus, "UP_TO_DATE");
    assert.equal(acme.decision, "PENDING");
    assert.equal(acme.completedReviewCount, 1);
    assert.equal(acme.pendingReviewCount, 1);
    assert.equal(acme.openReviewCount, 1);
    assert.equal(acme.nextReviewDeadlineAt, "2026-12-01T00:00:00Z");
    assert.equal("reviews" in acme, false, "per-review detail is opt-in via fields[]");
    assert.equal("latestCompletedReview" in acme, false, "latestCompletedReview is opt-in via fields[]");
    assert.match(res.result.detailNote, /fields/);
  });

  it("fields[] opts back into per-review detail", async () => {
    const { checkVendorSecurityReviews } = await import(
      "../dist/handlers/check-vendor-security-reviews.handler.js"
    );
    const res = await checkVendorSecurityReviews({
      fields: ["reviews", "latestCompletedReview"],
    });

    const acme = res.result.hasReviews.find((v) => v.id === 10);
    assert.deepEqual(
      acme.reviews.map((r) => [r.id, r.status]),
      [
        [53, "COMPLETED"],
        [30, "NOT_YET_STARTED"],
      ],
    );
    assert.equal(acme.latestCompletedReview.id, 53);
    assert.equal(acme.latestCompletedReview.decision, "PENDING");
  });

  it("unsupported fields error loudly instead of being silently ignored", async () => {
    const { checkVendorSecurityReviews } = await import(
      "../dist/handlers/check-vendor-security-reviews.handler.js"
    );
    const res = await checkVendorSecurityReviews({ fields: ["bogus"] });

    assert.equal(res.isError, true);
    assert.match(res.error, /bogus/);
    assert.match(res.error, /reviews, latestCompletedReview/);
  });

  it("marks archived vendors and reports the count; notes precede the arrays", async () => {
    const { checkVendorSecurityReviews } = await import(
      "../dist/handlers/check-vendor-security-reviews.handler.js"
    );
    const res = await checkVendorSecurityReviews();

    assert.equal(res.result.archivedVendorsIncluded, 1);
    const aws = res.result.needsReview.find((v) => v.id === 40);
    assert.ok(aws, "archived AWS shell still listed (marked, not hidden)");
    assert.equal(aws.archived, true);
    const eventOnly = res.result.unknownStatus.find((v) => v.id === 77);
    assert.ok(eventOnly, "fallback-only vendor stays UNKNOWN");

    const keys = Object.keys(res.result);
    assert.equal(keys[0], "totalVendors");
    assert.ok(keys.indexOf("semanticsNote") < keys.indexOf("hasReviews"));
    assert.ok(keys.indexOf("detailNote") < keys.indexOf("hasReviews"));
  });
});

describe("tool descriptions match behavior", () => {
  it("list_security_review_actions does not claim SOC_REPORT-only support", async () => {
    const { VendorSecurityReviewReadTools } = await import(
      "../dist/tools/v2/get-vendor-security-review.tool.js"
    );
    const tool = VendorSecurityReviewReadTools.map((f) => f()).find(
      (t) => t.name === "list_security_review_actions",
    );
    assert.ok(tool);
    assert.doesNotMatch(tool.description, /Only SOC_REPORT/i);
    assert.match(tool.description, /all review types/i);
  });

  it("check_vendor_risk description states COMPLETED-only counting", async () => {
    const tool = (await import("../dist/tools/check/check-vendors.tool.js")).default();
    assert.match(tool.description, /COMPLETED/);
    assert.match(tool.description, /archived/i);
    assert.doesNotMatch(tool.description, /missing entirely/);
  });

  it("get_vendor description warns it carries no review data", async () => {
    const tool = (await import("../dist/tools/get/get-vendor.tool.js")).default();
    assert.match(tool.description, /NO security-review data/i);
    assert.match(tool.description, /list_vendor_security_reviews/);
  });

  it("list_vendor_security_review_statuses exposes the fields[] parameter", async () => {
    const tool = (
      await import("../dist/tools/check/check-vendor-security-reviews.tool.js")
    ).default();
    assert.ok(tool.schema.fields, "fields param must be in the schema");
    assert.match(tool.description, /compact/i);
  });
});
