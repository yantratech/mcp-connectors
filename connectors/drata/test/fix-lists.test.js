/**
 * Regression tests for V1 list tool output accuracy:
 *
 *  1. list_controls excludes archived controls by default, reports a leading
 *     excludedArchived count, marks archived rows when includeArchived is
 *     set, reports unmatchedCodes[] instead of silently dropping typos, and
 *     carries a semanticsNote about the narrow V1 hasEvidence flag.
 *
 *  2. list_vendors is compact-by-default (id/name/category/risk/critical/
 *     impactLevel/isArchived) with leading active/archived counts and
 *     list_assets-style pagination; full fields stay opt-in via fields[].
 *
 *  3. list_assets excludes removed (removedAt != null) assets by default so
 *     `total` matches the app's live inventory, with an includeRemoved flag
 *     and a leading activeTotal/removedTotal breakdown.
 *
 *  4. list_personnel surfaces Drata's own complianceChecks verdicts as a
 *     compact {TYPE: STATUS} map per person.
 *
 * Stands up a local mock Drata API (same pattern as the e2e suite) and
 * drives the compiled handlers in dist against it.
 *
 * Run: node --test test/fix-lists.test.js
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

const CONTROLS = [
  {
    id: 1,
    code: "DCF-1",
    name: "Active control one",
    archivedAt: null,
    isReady: true,
    isMonitored: true,
    hasEvidence: true,
    hasOwner: true,
    frameworkTags: ["SOC 2"],
  },
  {
    id: 2,
    code: "DCF-2",
    name: "Active control two",
    archivedAt: null,
    isReady: false,
    isMonitored: false,
    hasEvidence: false,
    hasOwner: false,
    frameworkTags: ["SOC 2"],
  },
  {
    id: 9,
    code: "DCF-9",
    name: "Archived control",
    archivedAt: "2026-06-01T12:00:00.000Z",
    isReady: false,
    isMonitored: false,
    hasEvidence: false,
    hasOwner: true,
    frameworkTags: ["SOC 2"],
  },
];

const VENDORS = [
  {
    id: 1,
    name: "Acme Cloud",
    category: "ENGINEERING",
    risk: "HIGH",
    critical: true,
    impactLevel: "MAJOR",
    status: null,
    archivedAt: null,
    dataStored: "PII ".repeat(200),
    servicesProvided: "prose ".repeat(200),
  },
  {
    id: 2,
    name: "Beta Tools",
    category: "PRODUCT",
    risk: "LOW",
    critical: false,
    impactLevel: "MINOR",
    status: "ACTIVE",
    archivedAt: null,
    dataStored: "None",
    servicesProvided: "Dev tooling",
  },
  {
    id: 3,
    name: "Old Shell",
    category: "PRODUCT",
    risk: "NONE",
    critical: false,
    impactLevel: "UNSCORED",
    status: "ARCHIVED",
    archivedAt: "2026-07-02T12:00:00.000Z",
    dataStored: null,
    servicesProvided: null,
  },
];

const ASSETS = [
  { id: 1, name: "Laptop A", assetType: "PHYSICAL", removedAt: null },
  { id: 2, name: "Bucket B", assetType: "VIRTUAL", removedAt: null },
  { id: 3, name: "Repo C", assetType: "VIRTUAL", removedAt: null },
  {
    id: 4,
    name: "Old instance",
    assetType: "VIRTUAL",
    removedAt: "2026-04-12T12:00:00.000Z",
  },
  {
    id: 5,
    name: "Old bucket",
    assetType: "VIRTUAL",
    removedAt: "2026-04-11T12:00:00.000Z",
  },
];

const PERSONNEL = [
  {
    id: 1,
    employmentStatus: "CURRENT_EMPLOYEE",
    complianceChecks: [
      { id: 11, type: "FULL_COMPLIANCE", status: "PASS" },
      { id: 12, type: "ACCEPTED_POLICIES", status: "PASS" },
      { id: 13, type: "BG_CHECK", status: "EXCLUDED" },
      { id: 14, type: "SECURITY_TRAINING", status: "PASS" },
    ],
    user: {
      id: 10,
      firstName: "Sally",
      lastName: "Smith",
      email: "sally@example.com",
      jobTitle: "Engineer",
      roles: ["EMPLOYEE"],
      drataTermsAgreedAt: null,
      backgroundChecks: [{ id: 1, status: "CLEARED" }],
      documents: [],
    },
  },
  {
    id: 2,
    employmentStatus: "CURRENT_EMPLOYEE",
    complianceChecks: [
      { id: 21, type: "FULL_COMPLIANCE", status: "FAIL" },
      { id: 22, type: "ACCEPTED_POLICIES", status: "FAIL" },
    ],
    user: {
      id: 20,
      firstName: "Alex",
      lastName: "Adams",
      email: "alex@example.com",
      jobTitle: "Analyst",
      roles: ["EMPLOYEE"],
      drataTermsAgreedAt: "2026-01-01T00:00:00.000Z",
      backgroundChecks: [],
      documents: [],
    },
  },
];

let server;

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/public/controls") {
      return json(res, { data: CONTROLS, total: CONTROLS.length });
    }
    if (url.pathname === "/public/vendors") {
      return json(res, { data: VENDORS, total: VENDORS.length });
    }
    if (url.pathname === "/public/assets") {
      return json(res, { data: ASSETS, total: ASSETS.length });
    }
    if (url.pathname === "/public/personnel") {
      return json(res, { data: PERSONNEL, total: PERSONNEL.length });
    }
    return json(res, { statusCode: 404, message: "not found" }, 404);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.DRATA_API_KEY = "test-key";
  process.env.DRATA_BASE_URL = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function handlers() {
  return import("../dist/handlers/list-entities.handler.js");
}

// ── list_controls: archived exclusion + hasEvidence semantics ──

describe("list_controls archived handling", () => {
  it("excludes archived controls by default with a leading excludedArchived count", async () => {
    const { listControls } = await handlers();
    const res = await listControls();
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.total, 2);
    assert.equal(res.result.excludedArchived, 1);
    assert.ok(
      !res.result.controls.some((c) => c.code === "DCF-9"),
      "archived control must not appear by default",
    );
    // Counts and notes must serialize before the array so truncated reads
    // still see correct aggregates.
    const keys = Object.keys(res.result);
    assert.equal(keys[0], "total");
    assert.equal(keys[keys.length - 1], "controls");
    assert.ok(keys.indexOf("excludedArchived") < keys.indexOf("controls"));
  });

  it("carries a semanticsNote flagging the narrow V1 hasEvidence flag", async () => {
    const { listControls } = await handlers();
    const res = await listControls();
    assert.match(res.result.semanticsNote, /hasEvidence/);
    assert.match(res.result.semanticsNote, /check_control_status/);
    assert.match(res.result.semanticsNote, /polic/i);
  });

  it("includeArchived returns archived rows marked with isArchived/archivedAt", async () => {
    const { listControls } = await handlers();
    const res = await listControls(undefined, { includeArchived: true });
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.total, 3);
    assert.equal(res.result.excludedArchived, 0);
    const archived = res.result.controls.find((c) => c.code === "DCF-9");
    assert.equal(archived.isArchived, true);
    assert.equal(archived.archivedAt, "2026-06-01T12:00:00.000Z");
    const active = res.result.controls.find((c) => c.code === "DCF-1");
    assert.equal(active.isArchived, false);
    assert.equal(active.archivedAt, null);
  });

  it("fields[] can surface archivedAt when includeArchived is set", async () => {
    const { listControls } = await handlers();
    const res = await listControls(undefined, {
      includeArchived: true,
      fields: ["code", "archivedAt"],
    });
    const archived = res.result.controls.find((c) => c.code === "DCF-9");
    assert.deepEqual(archived, {
      code: "DCF-9",
      archivedAt: "2026-06-01T12:00:00.000Z",
    });
  });

  it("reports unmatchedCodes[] instead of silently dropping unknown codes", async () => {
    const { listControls } = await handlers();
    const res = await listControls(undefined, {
      codes: ["dcf-1", "DCF-999"],
    });
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.total, 1);
    assert.deepEqual(res.result.unmatchedCodes, ["DCF-999"]);
    // No noise key when every code matches.
    const clean = await listControls(undefined, { codes: ["DCF-1"] });
    assert.ok(!("unmatchedCodes" in clean.result));
  });
});

// ── list_vendors: compact default + pagination + breakdown ─────

describe("list_vendors compact pagination", () => {
  it("returns compact rows by default with leading active/archived counts", async () => {
    const { listVendors } = await handlers();
    const res = await listVendors();
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.total, 3);
    assert.equal(res.result.activeTotal, 2);
    assert.equal(res.result.archivedTotal, 1);
    assert.equal(res.result.returned, 3);
    assert.equal(res.result.hasMore, false);
    const row = res.result.vendors.find((v) => v.id === 1);
    assert.deepEqual(Object.keys(row).sort(), [
      "category",
      "critical",
      "id",
      "impactLevel",
      "isArchived",
      "name",
      "risk",
    ]);
    assert.ok(
      !("dataStored" in row),
      "heavy prose fields must be dropped by default",
    );
    // Counts before the array.
    const keys = Object.keys(res.result);
    assert.equal(keys[0], "total");
    assert.equal(keys[keys.length - 1], "vendors");
  });

  it("marks archived vendors even when their status field is unreliable", async () => {
    const { listVendors } = await handlers();
    const res = await listVendors();
    assert.equal(res.result.vendors.find((v) => v.id === 3).isArchived, true);
    // status: null on most live records — must still read as active.
    assert.equal(res.result.vendors.find((v) => v.id === 1).isArchived, false);
  });

  it("restores raw fields via fields[] opt-in", async () => {
    const { listVendors } = await handlers();
    const res = await listVendors({ fields: ["id", "dataStored"] });
    const row = res.result.vendors.find((v) => v.id === 1);
    assert.deepEqual(Object.keys(row).sort(), ["dataStored", "id"]);
    assert.match(row.dataStored, /PII/);
  });

  it("paginates with size/page and reports hasMore", async () => {
    const { listVendors } = await handlers();
    const res = await listVendors({ size: 1, page: 2 });
    assert.equal(res.result.returned, 1);
    assert.equal(res.result.page, 2);
    assert.equal(res.result.limit, 1);
    assert.equal(res.result.vendors[0].id, 2);
    assert.equal(res.result.hasMore, true);
  });
});

// ── list_assets: removed-assets breakdown ──────────────────────

describe("list_assets removed handling", () => {
  it("excludes removed assets by default so total matches the app inventory", async () => {
    const { listAssets } = await handlers();
    const res = await listAssets();
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.total, 3);
    assert.equal(res.result.activeTotal, 3);
    assert.equal(res.result.removedTotal, 2);
    assert.equal(res.result.returned, 3);
    assert.ok(
      res.result.assets.every((a) => a.removedAt == null),
      "no removed asset may appear by default",
    );
    assert.match(res.result.note, /includeRemoved/);
    const keys = Object.keys(res.result);
    assert.equal(keys[0], "total");
    assert.equal(keys[keys.length - 1], "assets");
  });

  it("includeRemoved pages through removed assets too, rows marked by removedAt", async () => {
    const { listAssets } = await handlers();
    const res = await listAssets({ includeRemoved: true });
    assert.equal(res.result.total, 5);
    assert.equal(res.result.activeTotal, 3);
    assert.equal(res.result.removedTotal, 2);
    assert.ok(res.result.assets.some((a) => a.removedAt != null));
  });

  it("paginates over the filtered scope", async () => {
    const { listAssets } = await handlers();
    const res = await listAssets({ size: 2, page: 2 });
    assert.equal(res.result.returned, 1);
    assert.equal(res.result.hasMore, false);
    assert.equal(res.result.total, 3);
  });
});

// ── list_personnel: real compliance status passthrough ─────────

describe("list_personnel complianceChecks", () => {
  it("surfaces Drata's own verdicts as a {TYPE: STATUS} map", async () => {
    const { listPersonnel } = await handlers();
    const res = await listPersonnel();
    assert.equal(res.isError, false, res.error);
    const sally = res.result.personnel.find((p) => p.id === 1);
    assert.deepEqual(sally.complianceChecks, {
      FULL_COMPLIANCE: "PASS",
      ACCEPTED_POLICIES: "PASS",
      BG_CHECK: "EXCLUDED",
      SECURITY_TRAINING: "PASS",
    });
    const alex = res.result.personnel.find((p) => p.id === 2);
    assert.equal(alex.complianceChecks.FULL_COMPLIANCE, "FAIL");
  });

  it("warns that termsAgreed is not policy acknowledgement", async () => {
    const { listPersonnel } = await handlers();
    const res = await listPersonnel();
    assert.match(res.result.semanticsNote, /termsAgreed/);
    assert.match(res.result.semanticsNote, /ACCEPTED_POLICIES/);
  });

  it("fields[] projection still applies to complianceChecks", async () => {
    const { listPersonnel } = await handlers();
    const slim = await listPersonnel({ fields: ["id", "email"] });
    assert.deepEqual(
      Object.keys(slim.result.personnel[0]).sort(),
      ["email", "id"],
    );
    const withChecks = await listPersonnel({
      fields: ["id", "complianceChecks"],
    });
    assert.deepEqual(
      Object.keys(withChecks.result.personnel[0]).sort(),
      ["complianceChecks", "id"],
    );
  });
});
