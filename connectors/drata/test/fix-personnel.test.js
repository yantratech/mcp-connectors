/**
 * Regression tests for check_personnel_compliance output accuracy:
 *
 *  1. Compliance booleans come from Drata's own per-person complianceChecks
 *     (ACCEPTED_POLICIES / BG_CHECK / SECURITY_TRAINING / FULL_COMPLIANCE).
 *     EXCLUDED status means not-applicable, never "missing".
 *
 *  2. (scoping) Only current employees/contractors are scored by default;
 *     former employees, service accounts, and bots land in a labeled
 *     nonCurrent section (or are scored explicitly via includeNonCurrent),
 *     and every bucket entry carries employmentStatus.
 *
 *  3. (size) The trailing personnel array is compact-by-default
 *     (backgroundChecks/documents as counts, opt back in via fields[]),
 *     counts serialize before arrays, and device/agent posture checks are
 *     surfaced verbatim under failedChecks.
 *
 * Stands up a local mock Drata API (same pattern as the e2e suite) and
 * drives the compiled handler/tool in dist against it.
 *
 * Run: node --test test/fix-personnel.test.js
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

const chk = (type, status) => ({
  id: Math.floor(Math.random() * 100000),
  type,
  status,
  completionDate: null,
  expiresAt: null,
  checkFrequency: "DAILY",
  lastCheckedAt: "2026-07-30T00:00:00.000Z",
});

const FUTURE = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();

// Mirrors the live /public/personnel shape (nested user, complianceChecks).
const PERSONNEL = [
  {
    // Never clicked Drata's own ToS (drataTermsAgreedAt null) but PASSES all
    // real checks. drataTermsAgreedAt is not a compliance signal, so this
    // person must not be flagged.
    id: 1,
    employmentStatus: "CURRENT_EMPLOYEE",
    devicesCount: 1,
    user: {
      id: 10,
      firstName: "Ben",
      lastName: "Passing",
      email: "ben@example.com",
      jobTitle: "Engineer",
      roles: ["EMPLOYEE"],
      drataTermsAgreedAt: null,
      backgroundChecks: [],
      documents: [],
    },
    complianceChecks: [
      chk("FULL_COMPLIANCE", "PASS"),
      chk("ACCEPTED_POLICIES", "PASS"),
      chk("BG_CHECK", "PASS"),
      chk("SECURITY_TRAINING", "PASS"),
      chk("AGENT_INSTALLED", "FAIL"),
      chk("HIPAA_TRAINING", "FAIL"),
    ],
  },
  {
    // Clicked Drata's ToS, has bg-check history and a current SEC_TRAINING
    // doc, but Drata says FAIL across the board. Must be flagged on all three
    // buckets: those proxy fields never override Drata's own checks.
    id: 2,
    employmentStatus: "CURRENT_EMPLOYEE",
    devicesCount: 1,
    user: {
      id: 20,
      firstName: "Fay",
      lastName: "Failing",
      email: "fay@example.com",
      jobTitle: "Analyst",
      roles: ["EMPLOYEE"],
      drataTermsAgreedAt: "2024-01-01T00:00:00.000Z",
      backgroundChecks: [{ id: 900, status: "CLEARED" }],
      documents: [{ id: 901, type: "SEC_TRAINING", renewalDate: FUTURE }],
    },
    complianceChecks: [
      chk("FULL_COMPLIANCE", "FAIL"),
      chk("ACCEPTED_POLICIES", "FAIL"),
      chk("BG_CHECK", "FAIL"),
      chk("SECURITY_TRAINING", "FAIL"),
    ],
  },
  {
    // Contractor whose BG_CHECK is EXCLUDED (not applicable) — must not be
    // reported as missing a background check.
    id: 3,
    employmentStatus: "CURRENT_CONTRACTOR",
    devicesCount: 1,
    user: {
      id: 30,
      firstName: "Mia",
      lastName: "Excluded",
      email: "mia@example.com",
      jobTitle: "Contractor",
      roles: ["EMPLOYEE"],
      drataTermsAgreedAt: null,
      backgroundChecks: [],
      documents: [],
    },
    complianceChecks: [
      chk("FULL_COMPLIANCE", "PASS"),
      chk("ACCEPTED_POLICIES", "PASS"),
      chk("BG_CHECK", "EXCLUDED"),
      chk("SECURITY_TRAINING", "PASS"),
    ],
  },
  {
    // Current employee with no complianceChecks data at all — compliance is
    // unknown, not assumed missing/non-compliant.
    id: 4,
    employmentStatus: "CURRENT_EMPLOYEE",
    user: {
      id: 40,
      firstName: "Nou",
      lastName: "Data",
      email: "nou@example.com",
      jobTitle: "Engineer",
      roles: ["EMPLOYEE"],
      drataTermsAgreedAt: null,
      backgroundChecks: [],
      documents: [],
    },
  },
  {
    // Service account: FULL_COMPLIANCE PASS with everything EXCLUDED. Not
    // current — must not be scored by default.
    id: 5,
    employmentStatus: "SERVICE_ACCOUNT",
    devicesCount: 0,
    user: {
      id: 50,
      firstName: "PMO",
      lastName: "Bot",
      email: "pmo@example.com",
      jobTitle: null,
      roles: [],
      drataTermsAgreedAt: null,
      backgroundChecks: [],
      documents: [],
    },
    complianceChecks: [
      chk("FULL_COMPLIANCE", "PASS"),
      chk("ACCEPTED_POLICIES", "EXCLUDED"),
      chk("BG_CHECK", "EXCLUDED"),
      chk("SECURITY_TRAINING", "EXCLUDED"),
    ],
  },
  {
    // Former employee failing everything — must not appear in the headline
    // buckets by default (not an actionable gap).
    id: 6,
    employmentStatus: "FORMER_EMPLOYEE",
    devicesCount: 1,
    user: {
      id: 60,
      firstName: "Gone",
      lastName: "Away",
      email: "gone@example.com",
      jobTitle: "Ex",
      roles: [],
      drataTermsAgreedAt: null,
      backgroundChecks: [],
      documents: [],
    },
    complianceChecks: [
      chk("FULL_COMPLIANCE", "FAIL"),
      chk("ACCEPTED_POLICIES", "FAIL"),
      chk("BG_CHECK", "FAIL"),
      chk("SECURITY_TRAINING", "FAIL"),
    ],
  },
];

let server;
let checkPersonnel;
let CheckPersonnelTool;

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/public/personnel") {
      return json(res, {
        data: PERSONNEL,
        total: PERSONNEL.length,
        page: 1,
        limit: 50,
      });
    }
    return json(res, { statusCode: 404, message: "not found" }, 404);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.DRATA_API_KEY = "test-key";
  process.env.DRATA_BASE_URL = `http://127.0.0.1:${server.address().port}`;

  const mod = await import("../dist/handlers/check-personnel.handler.js");
  checkPersonnel = mod.checkPersonnel;
  CheckPersonnelTool = (
    await import("../dist/tools/check/check-personnel.tool.js")
  ).default();
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("compliance derives from Drata's complianceChecks", () => {
  it("drataTermsAgreedAt is ignored: passing person with null ToS is NOT flagged", async () => {
    const res = await checkPersonnel();
    assert.equal(res.isError, false);
    const ben = res.result.personnel.find((p) => p.id === 1);
    assert.equal(ben.missingPolicyAck, false);
    assert.equal(ben.missingBackgroundCheck, false);
    assert.equal(ben.missingSecurityTraining, false);
    assert.equal(ben.isCompliant, true);
    assert.ok(
      !res.result.missingPolicyAck.some((r) => r.id === 1),
      "person with ACCEPTED_POLICIES=PASS must not be in missingPolicyAck",
    );
  });

  it("proxy fields are ignored: Drata FAILs flag a person even with ToS + bg history + current training doc", async () => {
    const res = await checkPersonnel();
    const fay = res.result.personnel.find((p) => p.id === 2);
    assert.equal(fay.missingPolicyAck, true);
    assert.equal(fay.missingBackgroundCheck, true);
    assert.equal(fay.missingSecurityTraining, true);
    assert.equal(fay.isCompliant, false);
    assert.ok(res.result.missingPolicyAck.some((r) => r.id === 2));
    assert.ok(res.result.missingBgCheck.some((r) => r.id === 2));
    assert.ok(res.result.missingTraining.some((r) => r.id === 2));
  });

  it("EXCLUDED means not-applicable, never missing", async () => {
    const res = await checkPersonnel();
    const mia = res.result.personnel.find((p) => p.id === 3);
    assert.equal(mia.missingBackgroundCheck, false);
    assert.equal(mia.isCompliant, true);
    assert.deepEqual(mia.excludedChecks, ["BG_CHECK"]);
    assert.ok(!res.result.missingBgCheck.some((r) => r.id === 3));
  });

  it("counts mirror FULL_COMPLIANCE over the scored set", async () => {
    const res = await checkPersonnel();
    // Scored (current): 1 (PASS), 2 (FAIL), 3 (PASS), 4 (no data).
    assert.equal(res.result.totalPersonnel, 6);
    assert.equal(res.result.scoredPersonnel, 4);
    assert.equal(res.result.compliantCount, 2);
    assert.equal(res.result.nonCompliantCount, 1);
    assert.equal(res.result.unknownComplianceCount, 1);
  });

  it("missing complianceChecks data → isCompliant null, no bucket membership", async () => {
    const res = await checkPersonnel();
    const nou = res.result.personnel.find((p) => p.id === 4);
    assert.equal(nou.isCompliant, null);
    assert.equal(nou.missingPolicyAck, false);
    for (const bucket of ["missingTraining", "missingBgCheck", "missingPolicyAck"]) {
      assert.ok(
        !res.result[bucket].some((r) => r.id === 4),
        `record without check data must not be counted in ${bucket}`,
      );
    }
  });

  it("device/agent posture checks are surfaced under failedChecks; FULL_COMPLIANCE is not", async () => {
    const res = await checkPersonnel();
    const ben = res.result.personnel.find((p) => p.id === 1);
    assert.ok(ben.failedChecks.includes("AGENT_INSTALLED"));
    assert.ok(ben.failedChecks.includes("HIPAA_TRAINING"));
    assert.ok(!ben.failedChecks.includes("FULL_COMPLIANCE"));
    // failedChecks can be non-empty on a compliant person (non-required
    // checks) — the semanticsNote must warn about exactly that.
    assert.equal(ben.isCompliant, true);
    assert.match(res.result.semanticsNote, /FULL_COMPLIANCE/);
    assert.match(res.result.semanticsNote, /EXCLUDED/);
  });

  it("termsAgreed (Drata ToS click) is gone from the output entirely", async () => {
    const res = await checkPersonnel();
    for (const p of res.result.personnel) {
      assert.ok(!("termsAgreed" in p), "termsAgreed must not leak into output");
    }
    assert.ok(!JSON.stringify(res.result).includes("termsAgreed"));
  });
});

describe("scoping: current personnel only by default", () => {
  it("former employees and service accounts are excluded from counts and buckets", async () => {
    const res = await checkPersonnel();
    const scoredIds = res.result.personnel.map((p) => p.id);
    assert.ok(!scoredIds.includes(5), "service account not scored");
    assert.ok(!scoredIds.includes(6), "former employee not scored");
    for (const bucket of ["missingTraining", "missingBgCheck", "missingPolicyAck"]) {
      assert.ok(
        !res.result[bucket].some((r) => r.id === 6),
        `former employee must not appear in ${bucket} by default`,
      );
    }
  });

  it("non-current records land in a labeled nonCurrent section with status breakdown", async () => {
    const res = await checkPersonnel();
    const nc = res.result.nonCurrent;
    assert.equal(nc.total, 2);
    assert.deepEqual(nc.byStatus, { SERVICE_ACCOUNT: 1, FORMER_EMPLOYEE: 1 });
    assert.match(nc.note, /NOT scored/);
    assert.match(nc.note, /includeNonCurrent/);
    const gone = nc.personnel.find((r) => r.id === 6);
    assert.equal(gone.employmentStatus, "FORMER_EMPLOYEE");
    assert.equal(gone.isCompliant, false);
  });

  it("every bucket entry carries employmentStatus", async () => {
    const res = await checkPersonnel();
    for (const bucket of ["missingTraining", "missingBgCheck", "missingPolicyAck"]) {
      for (const ref of res.result[bucket]) {
        assert.equal(typeof ref.employmentStatus, "string");
      }
    }
  });

  it("includeNonCurrent scores everyone and labels each entry", async () => {
    const res = await checkPersonnel({ includeNonCurrent: true });
    assert.equal(res.result.scoredPersonnel, 6);
    assert.equal(res.result.compliantCount, 3); // ids 1, 3, 5
    assert.equal(res.result.nonCompliantCount, 2); // ids 2, 6
    const gone = res.result.missingPolicyAck.find((r) => r.id === 6);
    assert.equal(gone.employmentStatus, "FORMER_EMPLOYEE");
    // Excluded-everything service account is still never "missing" anything.
    assert.ok(!res.result.missingPolicyAck.some((r) => r.id === 5));
    assert.match(res.result.nonCurrent.note, /Included/);
  });
});

describe("compact output and key order", () => {
  it("heavy arrays are compacted to counts by default", async () => {
    const res = await checkPersonnel();
    const fay = res.result.personnel.find((p) => p.id === 2);
    assert.ok(!("backgroundChecks" in fay));
    assert.ok(!("documents" in fay));
    assert.equal(fay.backgroundChecksCount, 1);
    assert.equal(fay.documentsCount, 1);
  });

  it("fields[] opts the full arrays (and raw complianceChecks) back in", async () => {
    const res = await checkPersonnel({
      fields: ["backgroundChecks", "documents", "complianceChecks"],
    });
    const fay = res.result.personnel.find((p) => p.id === 2);
    assert.equal(fay.backgroundChecks.length, 1);
    assert.equal(fay.documents.length, 1);
    assert.equal(fay.complianceChecks.length, 4);
    assert.equal(fay.complianceChecks[0].type, "FULL_COMPLIANCE");
  });

  it("counts and semanticsNote serialize before the personnel array", async () => {
    const res = await checkPersonnel();
    const text = JSON.stringify(res.result);
    for (const key of [
      '"totalPersonnel"',
      '"scoredPersonnel"',
      '"compliantCount"',
      '"nonCompliantCount"',
      '"semanticsNote"',
    ]) {
      assert.ok(
        text.indexOf(key) < text.indexOf('"personnel"'),
        `${key} must precede the personnel array`,
      );
    }
  });
});

describe("tool wire layer", () => {
  it("exposes includeNonCurrent and fields params and returns the new shape", async () => {
    assert.ok(CheckPersonnelTool.schema.includeNonCurrent);
    assert.ok(CheckPersonnelTool.schema.fields);
    const out = await CheckPersonnelTool.handler({});
    const parsed = JSON.parse(out.content[0].text);
    assert.equal(parsed.totalPersonnel, 6);
    assert.equal(parsed.scoredPersonnel, 4);
    assert.ok(Array.isArray(parsed.missingTraining));
    assert.ok(parsed.semanticsNote.includes("FULL_COMPLIANCE"));
  });

  it("description scopes device posture to failedChecks", () => {
    assert.match(CheckPersonnelTool.description, /failedChecks/);
    assert.match(CheckPersonnelTool.description, /FULL_COMPLIANCE/);
    assert.ok(
      !/device compliance\.?$/i.test(CheckPersonnelTool.description),
      "old blanket 'device compliance' promise must be gone",
    );
  });
});
