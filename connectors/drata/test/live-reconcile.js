/**
 * Live reconciliation harness: checks that the read tools match the Drata
 * web app for a workspace (SOC 2 frameworkId 1).
 *
 * Read-only: every handler exercised here only issues GETs.
 *
 *   DRATA_API_KEY=xxx DRATA_BASE_URL=https://public-api.eu.drata.com \
 *   DRATA_RECONCILE_EXPECT='{"vendorsWithReviews":<N>,...}' \
 *     node test/live-reconcile.js
 *
 * Structural checks (our counts equal Drata's own isReady flags and
 * numReadyInScopeRequirements, id disambiguation, input validation) always
 * run. Checks that compare against numbers read off the Drata app for a
 * specific workspace take their expected values from DRATA_RECONCILE_EXPECT
 * (a JSON object) and are skipped when a key is absent, so no compliance
 * posture is pinned in the repository. Keys:
 *
 *   vendorsWithReviews, vendorsWithoutReviews  - Vendors "Security review
 *       status": (Up to date + Needs review) / No past review
 *   vendorWithoutReview                        - name of a "No past review" vendor
 *   evidencedControls, unevidencedControls     - control codes (arrays)
 *   inScopeRequirements, readyRequirements     - SOC 2 by Requirements
 *   readyRequirementCodes, outOfScopeRequirementCodes - requirement codes (arrays)
 *   replay: { maxReviewId, completed, anyStatus } - reviews up to an id, the
 *       app's completed-only count and the count across every review status
 *   monitorCases: [{ monitorId, expectTestId, name }] - workspace monitor ids
 *       that collide with other test ids (name is a case-insensitive regex);
 *       collisionId - a bare id that is both a testId and a monitorId
 *
 * Skipped checks are counted separately in the summary, so a run without
 * DRATA_RECONCILE_EXPECT does not read as a full reconciliation.
 *
 * The ready-controls figure drifts with autopilot state; instead of pinning
 * it we assert our count equals the live V1+V2 isReady flags AND the derived
 * requirement readiness equals Drata's own numReadyInScopeRequirements.
 */
import assert from "node:assert";

if (!process.env.DRATA_API_KEY) {
  console.log("Skipping live reconciliation: DRATA_API_KEY is not set.");
  process.exit(0);
}

const { checkControls } = await import("../dist/handlers/check-controls.handler.js");
const { checkVendorSecurityReviews } = await import(
  "../dist/handlers/check-vendor-security-reviews.handler.js"
);
const { getFrameworkRequirementReadinessRollup, listMonitoringTestFailures, listFrameworks } =
  await import("../dist/handlers/v2-write.handler.js");

let EXPECT;
try {
  EXPECT = JSON.parse(process.env.DRATA_RECONCILE_EXPECT ?? "{}");
} catch (err) {
  console.error(`DRATA_RECONCILE_EXPECT is not valid JSON: ${err.message}`);
  process.exit(2);
}

const failures = [];
let checks = 0;
let skipped = 0;
function check(label, fn) {
  checks++;
  try {
    fn();
    console.log(`  ok    ${label}`);
  } catch (err) {
    failures.push({ label, err });
    console.log(`  FAIL  ${label}: ${err.message}`);
  }
}
/** Run `fn(expected)` only when DRATA_RECONCILE_EXPECT supplies `key`. */
function checkExpected(label, key, fn) {
  if (EXPECT[key] === undefined) {
    skipped++;
    console.log(`  skip  ${label} (no "${key}" in DRATA_RECONCILE_EXPECT)`);
    return;
  }
  check(label, () => fn(EXPECT[key]));
}

// ── 1. Controls ─────────────────────────────────────────────────
console.log("\n[1/4] check_control_status vs app (Frameworks -> SOC 2 by Controls)");
const frameworks = await listFrameworks(undefined);
const soc2 = frameworks.result.frameworks.find((f) => f.id === 1);
const noEvidence = await checkControls("no_evidence", "SOC 2", {});
// Request the per-source breakdown: the default is a slim projection with no
// `evidence` key.
const all = await checkControls("all", "SOC 2", {
  fields: ["code", "isReady", "hasEvidence", "evidence"],
});

check("SOC 2 denominator equals app in-scope controls (numInScopeControls)", () =>
  assert.equal(all.result.summary.totalControls, soc2.numInScopeControls));
check("ready count matches Drata readiness flags over in-scope controls", () =>
  assert.equal(
    all.result.summary.readyControls,
    all.result.controls.filter((c) => c.isReady).length,
  ));
const noEvidenceCodes = new Set(noEvidence.result.controls.map((c) => c.code));
checkExpected("controls with policy/test evidence in the app are NOT reported as no_evidence", "evidencedControls", (codes) => {
  for (const code of codes) assert.ok(!noEvidenceCodes.has(code), `${code} wrongly in no_evidence`);
});
checkExpected("controls the app shows without evidence remain no_evidence", "unevidencedControls", (codes) => {
  for (const code of codes) assert.ok(noEvidenceCodes.has(code), `${code} missing from no_evidence`);
});
check("archived controls are excluded (denominator is the app's, not the raw total)", () =>
  assert.ok(all.result.summary.archivedControlsExcluded > 0));
check("hasEvidence equals evidence of ANY kind in each control's breakdown", () => {
  for (const c of all.result.controls) {
    const e = c.evidence;
    const anyKind =
      e.externalEvidenceCount > 0 ||
      e.evidenceLibraryReportCount > 0 ||
      e.hasMappedPolicy ||
      e.monitorTestCount > 0;
    assert.equal(c.hasEvidence, anyKind, `${c.code} hasEvidence disagrees with its breakdown`);
  }
});

// ── 2. Vendors ──────────────────────────────────────────────────
console.log("\n[2/4] list_vendor_security_review_statuses vs app 'Security review status'");
// Per-review detail is opt-in; the replay check below needs it.
const vendors = await checkVendorSecurityReviews({ fields: ["reviews"] });
const vr = vendors.result;
// App: "Up to date" + "Needs review" vendors all have a past COMPLETED
// review; "No past review" vendors have none.
checkExpected("completed-only rule: vendors with a past review match the app", "vendorsWithReviews", (n) =>
  assert.equal(vr.vendorsWithReviews, n));
checkExpected("completed-only rule: vendors without a past review match the app", "vendorsWithoutReviews", (n) =>
  assert.equal(vr.vendorsWithoutReviews, n));
checkExpected("a 'No past review' vendor in the app is in needsReview", "vendorWithoutReview", (name) =>
  assert.ok(vr.needsReview.some((v) => v.name === name)));
check("no vendor with only NOT_YET_STARTED/NOT_REQUIRED shells counts as reviewed", () =>
  assert.ok(
    vr.hasReviews.every((v) => v.completedReviewCount > 0),
    "a vendor without a COMPLETED review leaked into hasReviews",
  ));
check("per-vendor decision is surfaced for completed reviews", () => {
  assert.ok(vr.hasReviews.every((v) => typeof v.decision === "string"));
  assert.ok(vr.hasReviews.some((v) => v.decision === "APPROVED"));
});

// Historical replay: counting COMPLETED reviews up to replay.maxReviewId
// reproduces the app count at that point; replay.anyStatus pins the different
// count across every review status, which the app does not use.
checkExpected("historical replay matches the app count", "replay", (replay) => {
  const asOfReplay = vr.hasReviews.concat(vr.needsReview, vr.unknownStatus).map((v) => {
    const reviews = (v.reviews ?? []).filter((r) => !r.id || r.id <= replay.maxReviewId);
    return {
      completed: reviews.filter((r) => r.status === "COMPLETED").length,
      any: reviews.length,
    };
  });
  assert.equal(asOfReplay.filter((v) => v.completed > 0).length, replay.completed);
  assert.equal(asOfReplay.filter((v) => v.any > 0).length, replay.anyStatus);
});

// ── 3. Framework requirements ───────────────────────────────────
console.log("\n[3/4] get_framework_requirement_readiness_rollup vs app (by Requirements)");
const rollup = await getFrameworkRequirementReadinessRollup(undefined, {
  frameworkId: 1,
  size: 100,
});
const fw = rollup.result.framework;
checkExpected("in-scope requirement count matches the app", "inScopeRequirements", (n) =>
  assert.equal(fw.inScopeRequirements, n));
checkExpected("ready requirement count matches the app", "readyRequirements", (n) =>
  assert.equal(fw.readyRequirements, n));
check("framework totals agree with Drata's own numbers (matchesDrataReported)", () =>
  assert.equal(fw.matchesDrataReported, true));
check("framework totals equal the sum of per-requirement isReady flags", () => {
  const readySum = rollup.result.requirements.filter((r) => r.isReady).length;
  assert.equal(fw.readyRequirements, readySum);
});
checkExpected("the ready requirements are the app's", "readyRequirementCodes", (codes) => {
  const readyCodes = rollup.result.requirements
    .filter((r) => r.isReady)
    .map((r) => r.code ?? r.name)
    .sort();
  assert.deepEqual(readyCodes, [...codes].sort());
});
checkExpected("out-of-scope = all-mapped-controls-archived", "outOfScopeRequirementCodes", (codes) => {
  const out = rollup.result.requirements
    .filter((r) => !r.isInScope)
    .map((r) => r.code ?? r.name)
    .sort();
  assert.deepEqual(out, [...codes].sort());
});
check("list_frameworks numbers agree with the rollup", () => {
  assert.equal(soc2.numReadyInScopeRequirements, fw.readyRequirements);
  assert.equal(soc2.numInScopeRequirements, fw.inScopeRequirements);
});

// ── 4. Monitoring test failures ─────────────────────────────────
console.log("\n[4/4] list_monitoring_test_failures: monitor/test id disambiguation");
// Monitor ids whose numbers collide with (or 200-empty as) other testIds.
// Monitor/test ids are workspace-specific, so they come from
// DRATA_RECONCILE_EXPECT.monitorCases.
for (const { monitorId, expectTestId, name } of EXPECT.monitorCases ?? []) {
  const res = await listMonitoringTestFailures(undefined, undefined, monitorId);
  check(`monitorId ${monitorId} resolves to ITS OWN test ${expectTestId}`, () => {
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.testId, expectTestId);
    assert.match(res.result.testName ?? "", new RegExp(name, "i"));
    assert.equal(res.result.resolvedFromMonitorId, monitorId);
  });
}
if (!EXPECT.monitorCases) {
  skipped++;
  console.log('  skip  monitorId -> own testId resolution (no "monitorCases" in DRATA_RECONCILE_EXPECT)');
}
if (EXPECT.collisionId !== undefined) {
  const id = EXPECT.collisionId;
  const ambiguous = await listMonitoringTestFailures(undefined, id, undefined);
  check(`bare testId ${id} (collision) is answered for that testId WITH an explicit ambiguity warning`, () => {
    assert.equal(ambiguous.isError, false, ambiguous.error);
    assert.equal(ambiguous.result.testId, id);
    assert.match(ambiguous.result.ambiguityNote ?? "", new RegExp(`monitorId: ${id}`));
  });
} else {
  skipped++;
  console.log('  skip  bare-id collision warning (no "collisionId" in DRATA_RECONCILE_EXPECT)');
}
const both = await listMonitoringTestFailures(undefined, 1, 1);
check("passing both testId and monitorId is rejected", () => {
  assert.equal(both.isError, true);
  assert.match(both.error, /exactly one/i);
});
const neither = await listMonitoringTestFailures(undefined, undefined, undefined);
check("passing neither testId nor monitorId is rejected", () => {
  assert.equal(neither.isError, true);
});
const bogus = await listMonitoringTestFailures(undefined, 999999, undefined);
check("an id in neither namespace errors instead of returning 200-empty", () => {
  assert.equal(bogus.isError, true);
  assert.match(bogus.error, /No monitoring test found/);
});

// ── Summary ─────────────────────────────────────────────────────
console.log(
  `\n${checks - failures.length}/${checks} reconciliation checks passed` +
    (skipped > 0 ? `; ${skipped} skipped (expectations not supplied).` : "."),
);
if (failures.length > 0) {
  console.error(`\n${failures.length} FAILED:`);
  for (const f of failures) console.error(` - ${f.label}: ${f.err.message}`);
  process.exit(1);
}
