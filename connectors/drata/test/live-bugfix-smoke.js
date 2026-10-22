#!/usr/bin/env node
/**
 * Live regression smoke against a real Drata tenant. Checks that the read
 * handlers and tools stay internally consistent (status buckets, envelopes,
 * pagination, size caps), agree with each other, and that the upstream API
 * still behaves the way the handlers assume.
 *
 * READ-ONLY. Never writes, never deletes.
 *
 * Usage:
 *   DRATA_API_KEY=xxx DRATA_BASE_URL=https://public-api.eu.drata.com \
 *   node test/live-bugfix-smoke.js
 *
 * DRATA_BASE_URL defaults to the NA region, as it does for the server.
 */
import assert from "node:assert/strict";

if (!process.env.DRATA_API_KEY) {
  console.error("Set DRATA_API_KEY env var");
  process.exit(1);
}

const { checkMonitors } = await import("../dist/handlers/check-monitors.handler.js");
const { getRecentEvents } = await import("../dist/handlers/get-recent-events.handler.js");
const { listFrameworks, listFrameworkRequirements, listWorkspaces } =
  await import("../dist/handlers/v2-write.handler.js");
const { checkPersonnel } = await import("../dist/handlers/check-personnel.handler.js");
const { checkVendorSecurityReviews } = await import(
  "../dist/handlers/check-vendor-security-reviews.handler.js"
);
const { runGapAnalysis } = await import("../dist/handlers/run-gap-analysis.handler.js");
const { getComplianceSummary } = await import(
  "../dist/handlers/get-compliance-summary.handler.js"
);

// Direct upstream probes use the same base URL the client resolves.
const baseUrl = process.env.DRATA_BASE_URL || "https://public-api.drata.com";
const auth = { Authorization: `Bearer ${process.env.DRATA_API_KEY}` };

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

function dur(ms) {
  return `${ms.toFixed(0)}ms`;
}

// ───────────────────────────────────────────────────────────────
// check_monitors status buckets
// ───────────────────────────────────────────────────────────────

console.log("\n── check_monitors status buckets (live) ──");
const monitorsT0 = performance.now();
const allMonitors = await checkMonitors();
// One page large enough for every monitor, so the filtered lists are complete.
const everyMonitor = { size: Math.max(1, allMonitors.result?.totalMonitors ?? 1) };
const failingMonitors = await checkMonitors("failing", everyMonitor);
const passingMonitors = await checkMonitors("passing", everyMonitor);
const disabledMonitors = await checkMonitors("disabled", everyMonitor);
const monitorsT1 = performance.now();

await test("checkMonitors() succeeds against live API", () => {
  assert.equal(allMonitors.isError, false, allMonitors.error);
  assert.ok(allMonitors.result.totalMonitors > 0, "expected some monitors");
  console.log(
    `    → ${allMonitors.result.totalMonitors} total monitors (${dur(monitorsT1 - monitorsT0)})`,
  );
});

await test("filter=failing holds no PASSED or READY monitor", () => {
  assert.equal(failingMonitors.isError, false, failingMonitors.error);
  const passingInFailing = failingMonitors.result.monitors.filter(
    (m) => m.status === "PASSED" || m.status === "READY",
  );
  assert.equal(
    passingInFailing.length,
    0,
    `failing-filtered list contained ${passingInFailing.length} passing monitor(s); ids: ${passingInFailing
      .map((m) => m.id)
      .slice(0, 5)
      .join(",")}`,
  );
  console.log(
    `    → failing=${failingMonitors.result.matched}, passing=${passingMonitors.result.matched}, disabled=${disabledMonitors.result.matched}`,
  );
});

await test("filter=passing holds only PASSED or READY monitors", () => {
  assert.equal(passingMonitors.isError, false, passingMonitors.error);
  const wrongStatuses = passingMonitors.result.monitors.filter(
    (m) => m.status !== "PASSED" && m.status !== "READY",
  );
  assert.equal(
    wrongStatuses.length,
    0,
    `passing-filtered contained non-passing statuses: ${[
      ...new Set(wrongStatuses.map((m) => m.status)),
    ].join(", ")}`,
  );
});

// Compact entries omit checkStatus when it is ENABLED, so a disabled monitor
// always carries checkStatus: "DISABLED".
await test("filter=passing holds no disabled monitor", () => {
  const wrong = passingMonitors.result.monitors.filter((m) => m.checkStatus === "DISABLED");
  assert.equal(wrong.length, 0, `${wrong.length} disabled monitors leaked into passing`);
});

await test("filter=disabled holds only disabled monitors", () => {
  assert.equal(disabledMonitors.isError, false, disabledMonitors.error);
  const wrong = disabledMonitors.result.monitors.filter((m) => m.checkStatus !== "DISABLED");
  assert.equal(wrong.length, 0);
});

await test("buckets partition cleanly: passing + failing + disabled = totalMonitors", () => {
  const { statusCounts, totalMonitors } = allMonitors.result;
  const sum = statusCounts.passing + statusCounts.failing + statusCounts.disabled;
  assert.equal(
    sum,
    totalMonitors,
    `passing(${statusCounts.passing}) + failing(${statusCounts.failing}) + disabled(${statusCounts.disabled}) = ${sum}, expected ${totalMonitors}`,
  );
  assert.equal(passingMonitors.result.matched, statusCounts.passing);
  assert.equal(failingMonitors.result.matched, statusCounts.failing);
  assert.equal(disabledMonitors.result.matched, statusCounts.disabled);
});

// Distribution of statuses in the wild — diagnostic, not assertion.
console.log(`    → status counts: ${JSON.stringify(allMonitors.result?.statusCounts ?? {})}`);

// ───────────────────────────────────────────────────────────────
// get_recent_events limit handling
// ───────────────────────────────────────────────────────────────

console.log("\n── get_recent_events limit handling (live) ──");

await test("limit=100 (over Drata's cap of 50) clamps and succeeds", async () => {
  const t0 = performance.now();
  const res = await getRecentEvents(100);
  assert.equal(res.isError, false, `Got error: ${res.error}`);
  assert.ok(
    res.result.count <= 50,
    `expected at most 50 events, got ${res.result.count}`,
  );
  console.log(`    → returned ${res.result.count} events (${dur(performance.now() - t0)})`);
});

await test("limit=50 (boundary) succeeds with no error", async () => {
  const res = await getRecentEvents(50);
  assert.equal(res.isError, false);
});

await test("limit=NaN coerces to default and does not crash upstream", async () => {
  const res = await getRecentEvents(Number.NaN);
  assert.equal(
    res.isError,
    false,
    `NaN should coerce, but got error: ${res.error}`,
  );
});

await test("limit=Infinity coerces to default", async () => {
  const res = await getRecentEvents(Infinity);
  assert.equal(res.isError, false, res.error);
});

await test("default limit (no arg) succeeds", async () => {
  const res = await getRecentEvents();
  assert.equal(res.isError, false);
  console.log(`    → default returned ${res.result.count} events`);
});

// ───────────────────────────────────────────────────────────────
// list_frameworks workspace resolution
// ───────────────────────────────────────────────────────────────

console.log("\n── list_frameworks workspace resolution (live) ──");

// First: discover what workspaces this token can see.
const wsT0 = performance.now();
const wsRes = await listWorkspaces();
console.log(`    → workspaces fetch (${dur(performance.now() - wsT0)})`);
await test("listWorkspaces succeeds", () => {
  assert.equal(wsRes.isError, false, wsRes.error);
});

const workspaceList = Array.isArray(wsRes.result?.workspaces) ? wsRes.result.workspaces : [];
const workspaceCount = workspaceList.length;
const firstWid = workspaceList[0]?.id;
console.log(`    → API key has access to ${workspaceCount} workspace(s)`);

await test("auto-resolve list_frameworks with no args/env succeeds", async () => {
  const savedEnv = process.env.DRATA_WORKSPACE_ID;
  delete process.env.DRATA_WORKSPACE_ID;
  try {
    const res = await listFrameworks();
    if (workspaceCount > 0) {
      assert.equal(res.isError, false, `Auto-resolve failed: ${res.error}`);
      const fwCount = Array.isArray(res.result?.frameworks)
        ? res.result.frameworks.length
        : "unknown";
      console.log(`    → auto-resolved to first workspace, returned ${fwCount} framework(s)`);
    } else {
      // Token may not have any workspaces — graceful error expected.
      assert.equal(res.isError, true);
    }
  } finally {
    if (savedEnv !== undefined) process.env.DRATA_WORKSPACE_ID = savedEnv;
  }
});

if (firstWid !== undefined) {
  await test(`explicit workspaceId=${firstWid} succeeds`, async () => {
    const res = await listFrameworks(firstWid);
    assert.equal(res.isError, false, res.error);
  });

  await test("env-var workspace resolution succeeds", async () => {
    process.env.DRATA_WORKSPACE_ID = String(firstWid);
    try {
      const res = await listFrameworks();
      assert.equal(res.isError, false, res.error);
    } finally {
      delete process.env.DRATA_WORKSPACE_ID;
    }
  });

  await test("listFrameworkRequirements auto-resolve succeeds", async () => {
    const savedEnv = process.env.DRATA_WORKSPACE_ID;
    delete process.env.DRATA_WORKSPACE_ID;
    try {
      const res = await listFrameworkRequirements();
      assert.equal(res.isError, false, res.error);
      console.log(`    → returned ${res.result?.total ?? "?"} requirement(s)`);
    } finally {
      if (savedEnv !== undefined) process.env.DRATA_WORKSPACE_ID = savedEnv;
    }
  });
}

// ───────────────────────────────────────────────────────────────
// check_personnel_compliance
// ───────────────────────────────────────────────────────────────

console.log("\n── check_personnel_compliance (live) ──");

const cpT0 = performance.now();
const cp = await checkPersonnel();
console.log(`    → personnel fetch (${dur(performance.now() - cpT0)})`);

await test("returns the summary fields", () => {
  assert.equal(cp.isError, false, cp.error);
  for (const key of [
    "totalPersonnel",
    "scoredPersonnel",
    "compliantCount",
    "nonCompliantCount",
    "unknownComplianceCount",
  ]) {
    assert.equal(typeof cp.result[key], "number", key);
  }
  assert.ok(Array.isArray(cp.result.missingTraining));
  assert.ok(Array.isArray(cp.result.missingBgCheck));
  assert.ok(Array.isArray(cp.result.missingPolicyAck));
});

await test("compliant + nonCompliant + unknown = scoredPersonnel", () => {
  assert.equal(
    cp.result.compliantCount + cp.result.nonCompliantCount + cp.result.unknownComplianceCount,
    cp.result.scoredPersonnel,
  );
});

await test("each scored record carries the compliance flags", () => {
  for (const p of cp.result.personnel) {
    assert.equal(typeof p.missingPolicyAck, "boolean", `id=${p.id}`);
    assert.equal(typeof p.missingBackgroundCheck, "boolean", `id=${p.id}`);
    assert.equal(typeof p.missingSecurityTraining, "boolean", `id=${p.id}`);
    // isCompliant mirrors Drata's FULL_COMPLIANCE rollup: null when Drata
    // reports no verdict for the person.
    assert.ok(
      p.isCompliant === null || typeof p.isCompliant === "boolean",
      `id=${p.id} isCompliant=${p.isCompliant}`,
    );
  }
});

await test("missing-* lists are consistent with per-record booleans", () => {
  for (const [list, flag] of [
    ["missingTraining", "missingSecurityTraining"],
    ["missingBgCheck", "missingBackgroundCheck"],
    ["missingPolicyAck", "missingPolicyAck"],
  ]) {
    const reported = cp.result[list].map((p) => p.id).sort();
    const computed = cp.result.personnel
      .filter((p) => p[flag])
      .map((p) => p.id)
      .sort();
    assert.deepEqual(reported, computed, `${list} must equal personnel where ${flag}=true`);
  }
});

// Diagnostic: distribution of compliance.
if (!cp.isError) {
  console.log(
    `    → compliant=${cp.result.compliantCount}/${cp.result.scoredPersonnel} scored, ` +
      `missingTraining=${cp.result.missingTraining.length}, ` +
      `missingBgCheck=${cp.result.missingBgCheck.length}, ` +
      `missingPolicyAck=${cp.result.missingPolicyAck.length}`,
  );
}

// ───────────────────────────────────────────────────────────────
// list_vendor_security_review_statuses
// ───────────────────────────────────────────────────────────────

console.log("\n── list_vendor_security_review_statuses (live) ──");

const vsrT0 = performance.now();
const vsr = await checkVendorSecurityReviews();
console.log(`    → vendor reviews fetch (${dur(performance.now() - vsrT0)})`);

await test("succeeds against live API", () => {
  assert.equal(vsr.isError, false, vsr.error);
});

await test("with + without + unknown review status = totalVendors", () => {
  assert.equal(
    vsr.result.vendorsWithReviews +
      vsr.result.vendorsWithoutReviews +
      vsr.result.vendorsWithUnknownStatus,
    vsr.result.totalVendors,
  );
});

await test("each vendor entry has the compact shape", () => {
  for (const v of [
    ...vsr.result.hasReviews,
    ...vsr.result.needsReview,
    ...vsr.result.unknownStatus,
  ]) {
    assert.equal(typeof v.id, "number");
    assert.equal(typeof v.name, "string");
    assert.equal(typeof v.completedReviewCount, "number");
    assert.equal(typeof v.totalReviewRecords, "number");
    assert.ok(v.totalReviewRecords >= v.completedReviewCount, `vendor ${v.id}`);
    // Per-review detail is opt-in via fields[].
    assert.equal(v.reviews, undefined, `vendor ${v.id} returned per-review detail by default`);
    assert.equal(v.securityReviews, undefined, `vendor ${v.id} leaked raw securityReviews`);
  }
});

await test("hasReviews holds only vendors with a COMPLETED review", () => {
  assert.ok(vsr.result.hasReviews.every((v) => v.completedReviewCount > 0));
});

if (!vsr.isError) {
  console.log(
    `    → ${vsr.result.totalVendors} vendors, ${vsr.result.vendorsWithReviews} with reviews, ` +
      `${vsr.result.vendorsWithoutReviews} without, ${vsr.result.vendorsWithUnknownStatus} unknown`,
  );
}

// ───────────────────────────────────────────────────────────────
// Gap analysis and compliance summary agree with check_monitors
// ───────────────────────────────────────────────────────────────

console.log("\n── gap-analysis vs check_monitors agreement (live) ──");

const gapT0 = performance.now();
const gap = await runGapAnalysis();
console.log(`    → gap analysis (${dur(performance.now() - gapT0)})`);

await test("runGapAnalysis succeeds", () => {
  assert.equal(gap.isError, false, gap.error);
});

await test("gap passingMonitors === check_monitors statusCounts.passing", () => {
  assert.equal(
    gap.result.overview.passingMonitors,
    allMonitors.result.statusCounts.passing,
    `gap=${gap.result.overview.passingMonitors}, checkMonitors=${allMonitors.result.statusCounts.passing}`,
  );
});

await test("gap failingMonitors === check_monitors statusCounts.failing", () => {
  assert.equal(
    gap.result.overview.failingMonitors,
    allMonitors.result.statusCounts.failing,
  );
});

await test("gap totalMonitors === check_monitors totalMonitors", () => {
  assert.equal(gap.result.overview.totalMonitors, allMonitors.result.totalMonitors);
});

await test("compliance-summary monitor counts agree too", async () => {
  const cs = await getComplianceSummary();
  assert.equal(cs.isError, false, cs.error);
  const { statusCounts } = allMonitors.result;
  assert.equal(
    cs.result.passingMonitors,
    statusCounts.passing,
    `compliance-summary=${cs.result.passingMonitors}, checkMonitors=${statusCounts.passing}`,
  );
  assert.equal(cs.result.failingMonitors, statusCounts.failing);
  assert.equal(cs.result.errorMonitors, statusCounts.error);
});

await test("gap.nextActions contains 'Fix N failing monitors' matching checkMonitors", () => {
  const failingCount = allMonitors.result.statusCounts.failing;
  const fix = gap.result.nextActions.find((a) => a.startsWith("PRIORITY 2: Fix"));
  if (failingCount === 0) {
    // A tenant may have 0 failing monitors — the action line should be absent.
    assert.equal(
      fix,
      undefined,
      "no failing monitors → no 'Fix N failing' action expected",
    );
  } else {
    assert.ok(fix, "expected a Fix-N-failing-monitors action");
    const match = fix.match(/Fix (\d+) failing monitors/);
    assert.ok(match, `couldn't parse count from: ${fix}`);
    assert.equal(
      Number(match[1]),
      failingCount,
      `nextActions claims ${match[1]} failing, checkMonitors found ${failingCount}`,
    );
  }
});

// ───────────────────────────────────────────────────────────────
// Direct API probes — verify load-bearing assumptions
// ───────────────────────────────────────────────────────────────

console.log("\n── Direct API probes (load-bearing assumptions) ──");

await test("/public/v2/personnel really lacks user details (justifies V1 fallback in flattenPersonnel)", async () => {
  const r = await fetch(`${baseUrl}/public/v2/personnel?size=3`, { headers: auth });
  assert.equal(r.status, 200);
  const body = await r.json();
  const sample = body.data?.[0] ?? {};
  assert.equal(
    "firstName" in sample,
    false,
    "V2 personnel unexpectedly includes firstName — flattenPersonnel can be simplified",
  );
  assert.equal(
    "email" in sample,
    false,
    "V2 personnel unexpectedly includes email",
  );
  console.log(`    → V2 personnel keys: ${Object.keys(sample).slice(0, 8).join(", ")}...`);
});

await test("Drata 400 on /public/events?limit=51 confirms the 50-cap assumption", async () => {
  const r = await fetch(`${baseUrl}/public/events?limit=51`, { headers: auth });
  assert.equal(
    r.status,
    400,
    `expected 400 from upstream when over cap, got ${r.status}`,
  );
  const body = await r.text();
  assert.match(body, /50/);
});

await test("/public/v2/vendors/{id}/security-reviews lists reviews (the primary review source)", async () => {
  const v = await fetch(`${baseUrl}/public/vendors?limit=1`, { headers: auth }).then((r) => r.json());
  const vid = v.data?.[0]?.id;
  if (vid === undefined) {
    console.log("    → no vendors on this tenant, skipping");
    return;
  }
  const r = await fetch(`${baseUrl}/public/v2/vendors/${vid}/security-reviews`, { headers: auth });
  assert.equal(r.status, 200, `expected 200 from the per-vendor review list, got ${r.status}`);
});

// ───────────────────────────────────────────────────────────────
// Pagination on real data
// ───────────────────────────────────────────────────────────────

console.log("\n── Pagination on real data ──");

await test("V1 pagination: every monitor served once across pages, no drops", async () => {
  const res = await checkMonitors(undefined, everyMonitor);
  assert.equal(res.isError, false, res.error);
  const ids = res.result.monitors.map((m) => m.id);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length, `duplicates: ${ids.length - unique.size}`);
  assert.equal(ids.length, res.result.totalMonitors, "a page sized to the total must hold every monitor");
});

await test("V2 cursor pagination: framework requirements walk to the end with no duplicates", async () => {
  const savedEnv = process.env.DRATA_WORKSPACE_ID;
  delete process.env.DRATA_WORKSPACE_ID;
  try {
    const seen = new Set();
    let duplicates = 0;
    let cursor = undefined;
    let pages = 0;
    while (true) {
      const params = { size: 50 };
      if (cursor) params.cursor = cursor;
      const res = await listFrameworkRequirements(undefined, params);
      assert.equal(res.isError, false, res.error);
      pages++;
      for (const r of res.result.requirements) {
        if (seen.has(r.id)) duplicates++;
        seen.add(r.id);
      }
      cursor = res.result.pagination?.cursor;
      if (!cursor || pages >= 200) break;
    }
    assert.ok(!cursor, `cursor still set after ${pages} pages`);
    assert.equal(duplicates, 0, `${duplicates} requirement(s) repeated across pages`);
    console.log(`    → ${seen.size} unique requirements across ${pages} cursor-advanced page(s)`);
  } finally {
    if (savedEnv !== undefined) process.env.DRATA_WORKSPACE_ID = savedEnv;
  }
});

// ───────────────────────────────────────────────────────────────
// Tool layer end-to-end (real API + Zod schema + MCP shape)
// ───────────────────────────────────────────────────────────────

console.log("\n── Tool layer end-to-end (live) ──");

const CheckMonitorsTool = (await import("../dist/tools/check/check-monitors.tool.js")).default();
const CheckPersonnelTool = (await import("../dist/tools/check/check-personnel.tool.js")).default();
const GetRecentEventsTool = (await import("../dist/tools/get/get-recent-events.tool.js")).default();
const ListFrameworksTool = (await import("../dist/tools/v2/list-frameworks.tool.js")).default();
const CheckVendorReviewsTool = (await import("../dist/tools/check/check-vendor-security-reviews.tool.js")).default();

await test("CheckMonitorsTool → MCP content with valid JSON payload", async () => {
  const out = await CheckMonitorsTool.handler({ filter: "failing" });
  assert.equal(out.content[0].type, "text");
  const parsed = JSON.parse(out.content[0].text);
  assert.equal(parsed.matched, allMonitors.result.statusCounts.failing);
});

await test("GetRecentEventsTool with limit=100 succeeds end-to-end (clamp at wire layer)", async () => {
  const out = await GetRecentEventsTool.handler({ limit: 100 });
  const parsed = JSON.parse(out.content[0].text);
  assert.ok(parsed.events.length <= 50);
});

await test("CheckPersonnelTool wraps the summary correctly", async () => {
  const out = await CheckPersonnelTool.handler({});
  const parsed = JSON.parse(out.content[0].text);
  assert.equal(typeof parsed.compliantCount, "number");
  assert.equal(typeof parsed.totalPersonnel, "number");
});

await test("CheckVendorReviewsTool has no `note` field at wire layer", async () => {
  const out = await CheckVendorReviewsTool.handler({});
  const parsed = JSON.parse(out.content[0].text);
  assert.equal(parsed.note, undefined);
});

await test("ListFrameworksTool surfaces handler errors as text, not exceptions", async () => {
  // Force an error path by setting an absurdly high explicit workspace id.
  const out = await ListFrameworksTool.handler({ workspaceId: 99999999 });
  // Either the handler returns a JSON success/error, or wrapper formats Error: …
  const t = out.content[0].text;
  assert.ok(typeof t === "string");
});

// ───────────────────────────────────────────────────────────────
// Compliance data sanity
// ───────────────────────────────────────────────────────────────

console.log("\n── Compliance data sanity (live) ──");

await test("missing-* refs all carry valid id and (optionally) email", () => {
  for (const list of [
    cp.result.missingTraining,
    cp.result.missingBgCheck,
    cp.result.missingPolicyAck,
  ]) {
    for (const ref of list) {
      assert.equal(typeof ref.id, "number");
      assert.equal(typeof ref.name, "string");
      // email may be null for ghost records (user=null)
      assert.ok(ref.email === null || typeof ref.email === "string");
    }
  }
});

// ───────────────────────────────────────────────────────────────
// Heavy concurrency, framework filter, and edge cases on live data
// ───────────────────────────────────────────────────────────────

console.log("\n── Heavy concurrency & framework filter (live) ──");

await test("3 concurrent runGapAnalysis calls all succeed and return identical overview", async () => {
  const t0 = performance.now();
  const results = await Promise.all([
    runGapAnalysis(),
    runGapAnalysis(),
    runGapAnalysis(),
  ]);
  const elapsed = performance.now() - t0;
  for (const r of results) {
    assert.equal(r.isError, false, r.error);
  }
  const a = JSON.stringify(results[0].result.overview);
  for (const r of results.slice(1)) {
    assert.equal(JSON.stringify(r.result.overview), a, "overview drifted across concurrent calls");
  }
  console.log(`    → 3 concurrent gap-analyses completed in ${dur(elapsed)}`);
});

// Discover actual framework tags from real controls.
const realControls = await (await fetch(`${baseUrl}/public/controls?limit=10`, { headers: auth })).json();
const knownTags = [...new Set((realControls.data ?? []).flatMap((c) => c.frameworkTags ?? []))];
console.log(`    → known framework tags: ${knownTags.slice(0, 5).join(", ")}${knownTags.length > 5 ? "..." : ""}`);

if (knownTags.length > 0) {
  const tag = knownTags[0];
  await test(`runGapAnalysis(${tag}) succeeds and filters controls`, async () => {
    const filtered = await runGapAnalysis(tag);
    const all = await runGapAnalysis();
    assert.equal(filtered.isError, false, filtered.error);
    assert.ok(
      filtered.result.overview.totalControls <= all.result.overview.totalControls,
      `framework filter increased control count from ${all.result.overview.totalControls} to ${filtered.result.overview.totalControls}`,
    );
    console.log(
      `    → ${tag}: ${filtered.result.overview.totalControls}/${all.result.overview.totalControls} controls`,
    );
  });
}

await test("runGapAnalysis with a deliberately bogus framework name returns a clean error", async () => {
  const res = await runGapAnalysis("DEFINITELY_NOT_A_REAL_FRAMEWORK_2026");
  assert.equal(res.isError, true);
  assert.match(res.error, /DEFINITELY_NOT_A_REAL_FRAMEWORK_2026/);
});

// ───────────────────────────────────────────────────────────────
// Env var edge cases on resolveOrFetchWorkspaceId
// ───────────────────────────────────────────────────────────────

console.log("\n── Env var edge cases (live) ──");

if (firstWid !== undefined) {
  await test("DRATA_WORKSPACE_ID with surrounding whitespace still resolves", async () => {
    process.env.DRATA_WORKSPACE_ID = ` ${firstWid} `;
    try {
      const res = await listFrameworks();
      // Number(" 7 ") === 7, so the padded value resolves to the same id.
      assert.equal(res.isError, false, `whitespace handling regressed: ${res.error}`);
    } finally {
      delete process.env.DRATA_WORKSPACE_ID;
    }
  });
}

await test("non-numeric DRATA_WORKSPACE_ID is rejected with a clear error", async () => {
  process.env.DRATA_WORKSPACE_ID = "abc-not-a-number";
  try {
    const res = await listFrameworks();
    assert.equal(res.isError, true);
    assert.match(res.error, /DRATA_WORKSPACE_ID must be a positive integer/);
  } finally {
    delete process.env.DRATA_WORKSPACE_ID;
  }
});

// ───────────────────────────────────────────────────────────────
// Workspace auto-resolve across handlers
// ───────────────────────────────────────────────────────────────

console.log("\n── workspace-id auto-resolve across handlers (live) ──");

// Use only the API: bypass our env var so handlers must auto-fetch workspaces.
delete process.env.DRATA_WORKSPACE_ID;

const { listMonitoringTestsV2, listEvidenceLibrary, listControlOwners } =
  await import("../dist/handlers/v2-write.handler.js");

await test("list_monitoring_tests_v2 with no args succeeds against live", async () => {
  const res = await listMonitoringTestsV2();
  assert.equal(res.isError, false, `error: ${res.error}`);
  console.log(`    → ${res.result.total} monitoring tests`);
});

await test("list_evidence_library with no args succeeds (or 402 if gated)", async () => {
  const res = await listEvidenceLibrary();
  // Some Drata plans gate this — accept either success or the friendly 402.
  if (res.isError) {
    assert.ok(
      res.httpStatus === 402 || /404|not found|paid Drata plan/i.test(res.error),
      `unexpected error: ${res.error}`,
    );
    console.log(`    → gated/unavailable: "${res.error}" (httpStatus=${res.httpStatus})`);
  } else {
    console.log(`    → ${res.result.total} evidence items`);
  }
});

await test("listControlOwners auto-resolves workspace (404 is OK if the control has no record)", async () => {
  // Pick a real control id from the V1 controls endpoint.
  const controlsRaw = await fetch(`${baseUrl}/public/controls?limit=1`, { headers: auth }).then(r => r.json());
  const cid = controlsRaw.data?.[0]?.id;
  assert.ok(cid, "no controls available to test against");
  const res = await listControlOwners(undefined, cid);
  // Either success or upstream 404 (no owners) — auto-resolve at minimum
  // means the URL should hit /public/v2/workspaces/<resolvedWid>/...
  assert.ok(
    res.isError === false || (res.isError && res.httpStatus !== undefined),
    `unexpected error shape: ${JSON.stringify(res)}`,
  );
});

console.log("\n── pagination size caps (live) ──");

const { listEventsV2 } = await import("../dist/handlers/v2-write.handler.js");
const { listAssets } = await import("../dist/handlers/list-entities.handler.js");

await test("list_events_v2 default response is < 50KB and includes pagination cursor", async () => {
  const res = await listEventsV2();
  assert.equal(res.isError, false, res.error);
  const size = JSON.stringify(res.result).length;
  console.log(`    → events response size: ${(size / 1024).toFixed(1)}KB, ${res.result.returned} on page`);
  assert.ok(size < 50 * 1024, `expected <50KB, got ${size}`);
  assert.ok(res.result.pagination, "must include pagination object");
});

await test("list_events_v2 sorts createdAt DESC by default", async () => {
  const res = await listEventsV2();
  if (res.result.events.length >= 2) {
    const first = Date.parse(res.result.events[0].createdAt);
    const second = Date.parse(res.result.events[1].createdAt);
    assert.ok(first >= second, `expected DESC sort, got first=${res.result.events[0].createdAt}, second=${res.result.events[1].createdAt}`);
  }
});

await test("list_events_v2 with `since` filters via createdAtFrom (no events older than yesterday)", async () => {
  const ListEventsV2Tool = (await import("../dist/tools/v2/list-events-v2.tool.js")).default();
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const out = await ListEventsV2Tool.handler({ since: yesterday });
  const parsed = JSON.parse(out.content[0].text);
  for (const e of parsed.events ?? []) {
    assert.ok(
      Date.parse(e.createdAt) >= Date.parse(yesterday),
      `event ${e.id} dated ${e.createdAt} is older than the since filter`,
    );
  }
  console.log(`    → ${parsed.events?.length ?? 0} events since yesterday`);
});

await test("list_assets default response is < 50KB and exposes hasMore", async () => {
  const res = await listAssets();
  assert.equal(res.isError, false, res.error);
  const size = JSON.stringify(res.result).length;
  console.log(`    → assets response size: ${(size / 1024).toFixed(1)}KB, page=${res.result.page}, total=${res.result.total}`);
  assert.ok(size < 50 * 1024);
  assert.equal(typeof res.result.hasMore, "boolean");
});

console.log("\n── V2 envelope consistency (live) ──");

const { listVendorTypes } = await import("../dist/handlers/v2-write.handler.js");

await test("listFrameworks returns { frameworks, total, pagination }", async () => {
  const res = await listFrameworks();
  assert.equal(res.isError, false, res.error);
  assert.ok(Array.isArray(res.result.frameworks), `got: ${JSON.stringify(Object.keys(res.result))}`);
  assert.equal(typeof res.result.total, "number");
  assert.ok(res.result.pagination);
  assert.equal(res.result.data, undefined);
});

await test("listVendorTypes returns { vendorTypes, total, pagination }", async () => {
  const res = await listVendorTypes();
  assert.equal(res.isError, false, res.error);
  assert.ok(Array.isArray(res.result.vendorTypes));
  assert.equal(typeof res.result.total, "number");
  assert.ok(res.result.pagination);
});

console.log("\n── connection health (live) ──");

const { listConnections } = await import("../dist/handlers/list-entities.handler.js");

await test("listConnections returns isHealthy / connected / health-summary fields", async () => {
  const res = await listConnections();
  assert.equal(res.isError, false, res.error);
  assert.equal(typeof res.result.healthyConnections, "number");
  assert.equal(typeof res.result.unhealthyConnections, "number");
  assert.equal(
    res.result.healthyConnections + res.result.unhealthyConnections,
    res.result.total,
  );
  for (const c of res.result.connections) {
    assert.equal(typeof c.isHealthy, "boolean", `id=${c.id}`);
    assert.equal(typeof c.connected, "boolean", `id=${c.id}`);
    // If failedAt is set, connected must be false.
    if (c.failedAt) {
      assert.equal(c.connected, false, `id=${c.id} failedAt set but connected=true`);
    }
  }
  console.log(`    → ${res.result.healthyConnections}/${res.result.total} connections healthy`);
});

await test("getComplianceSummary surfaces healthyConnections", async () => {
  const cs = await getComplianceSummary();
  assert.equal(cs.isError, false, cs.error);
  assert.equal(typeof cs.result.healthyConnections, "number");
  assert.ok(cs.result.healthyConnections <= cs.result.totalConnections);
});

console.log("\n── list_devices_v2 summary (live) ──");

const { listDevicesV2 } = await import("../dist/handlers/v2-write.handler.js");

await test("listDevicesV2 returns the fleet summary fields", async () => {
  const res = await listDevicesV2();
  assert.equal(res.isError, false, res.error);
  assert.equal(typeof res.result.totalDevices, "number");
  assert.equal(typeof res.result.devicesReporting, "number");
  assert.equal(typeof res.result.devicesWithEncryption, "number");
  assert.equal(typeof res.result.devicesWithScreenLock, "number");
  assert.equal(typeof res.result.devicesWithAntivirus, "number");
  assert.equal(typeof res.result.devicesWithPasswordManager, "number");
  assert.equal(typeof res.result.devicesWithAutoUpdates, "number");
  assert.ok(Array.isArray(res.result.nonReportingDevices));
  console.log(
    `    → total=${res.result.totalDevices}, reporting=${res.result.devicesReporting}, ` +
      `nonReporting=${res.result.nonReportingDeviceCount}, withEncryption=${res.result.devicesWithEncryption}`,
  );
});

console.log("\n── policy version status enum (live) ──");

const { listPolicyVersions } = await import("../dist/handlers/v2-write.handler.js");

await test("listPolicyVersions normalises nested policyStatus to string", async () => {
  // Pick the first available policy id.
  const policiesRaw = await fetch(`${baseUrl}/public/v2/policies?size=1`, { headers: auth }).then(r => r.json());
  const pid = policiesRaw.data?.[0]?.id;
  if (!pid) {
    console.log(`    → no policies on this workspace, skipping`);
    return;
  }
  const res = await listPolicyVersions(pid);
  assert.equal(res.isError, false, res.error);
  for (const v of res.result.versions) {
    if (v.policy && "policyStatus" in v.policy) {
      assert.equal(
        typeof v.policy.policyStatus,
        "string",
        `version ${v.id} policyStatus is ${typeof v.policy.policyStatus} (${v.policy.policyStatus})`,
      );
      // policyStatusCode should be the original number.
      assert.equal(typeof v.policy.policyStatusCode, "number");
    }
  }
  console.log(`    → ${res.result.versions.length} version(s) with normalised policyStatus`);
});

console.log("\n── 402 plan-gated mapping (live) ──");

const { listRiskRegisters } = await import("../dist/handlers/v2-write.handler.js");

await test("listRiskRegisters surfaces a clear plan-gated 402 (or works if Risk Management Pro is enabled)", async () => {
  const res = await listRiskRegisters();
  if (res.isError) {
    if (res.httpStatus === 402) {
      assert.match(res.error, /Risk Management Pro/);
      assert.equal(res.retryable, false);
      console.log(`    → plan-gated 402 for feature "${res.feature}"`);
    } else {
      console.log(`    → other error: "${res.error}"`);
    }
  } else {
    console.log(`    → Risk Management Pro is enabled on this workspace`);
  }
});

console.log("\n── search_vendors empty-query (live) ──");

await test("searchVendors('') is rejected without hitting the API", async () => {
  const { searchVendors } = await import("../dist/handlers/vendor-read.handler.js");
  const res = await searchVendors("");
  assert.equal(res.isError, true);
  assert.match(res.error, /non-empty/i);
});

await test("searchVendors('AWS') still works (positive control)", async () => {
  const { searchVendors } = await import("../dist/handlers/vendor-read.handler.js");
  const res = await searchVendors("AWS");
  assert.equal(res.isError, false);
});

// ───────────────────────────────────────────────────────────────
// Response size, envelope keys and `total` semantics
// ───────────────────────────────────────────────────────────────

console.log("\n── default size keeps responses < 40KB (live) ──");

await test("listAssets default response is < 40KB on live workspace", async () => {
  const { listAssets } = await import("../dist/handlers/list-entities.handler.js");
  const res = await listAssets();
  assert.equal(res.isError, false, res.error);
  const size = JSON.stringify(res.result).length;
  console.log(`    → live size: ${(size / 1024).toFixed(1)}KB, ${res.result.returned} of ${res.result.total} assets`);
  assert.ok(size < 40 * 1024, `expected <40KB, got ${size}`);
  assert.equal(res.result.limit, 20, "default size should be 20");
});

await test("listFrameworkRequirements default response is < 40KB on live workspace", async () => {
  const { listFrameworkRequirements } = await import("../dist/handlers/v2-write.handler.js");
  const res = await listFrameworkRequirements();
  assert.equal(res.isError, false, res.error);
  const size = JSON.stringify(res.result).length;
  console.log(`    → live size: ${(size / 1024).toFixed(1)}KB, ${res.result.returned} requirements`);
  assert.ok(size < 40 * 1024, `expected <40KB, got ${size}`);
});

console.log("\n── no V2 list/get tool returns top-level `data` (live sweep) ──");

const v2Handlers = await import("../dist/handlers/v2-write.handler.js");

const sweep = [
  ["listWorkspaces", () => v2Handlers.listWorkspaces(), "workspaces"],
  ["listFrameworks", () => v2Handlers.listFrameworks(), "frameworks"],
  ["listMonitoringTestsV2", () => v2Handlers.listMonitoringTestsV2(), "tests"],
  ["listVendorTypes", () => v2Handlers.listVendorTypes(), "vendorTypes"],
  ["listPoliciesV2", () => v2Handlers.listPoliciesV2(), "policies"],
  ["listEventsV2", () => v2Handlers.listEventsV2(), "events"],
];

for (const [name, fn, expectedKey] of sweep) {
  await test(`${name} → no top-level \`data\` field`, async () => {
    const res = await fn();
    assert.equal(res.isError, false, `${name} errored: ${res.error}`);
    assert.equal(res.result.data, undefined, `${name} leaked top-level data field`);
    assert.ok(
      Array.isArray(res.result[expectedKey]),
      `${name} missing typed key \`${expectedKey}\``,
    );
  });
}

// listControlOwners needs a controlId — pull one from V1 controls.
await test("listControlOwners → no top-level `data` field", async () => {
  const c = await fetch(`${baseUrl}/public/controls?limit=1`, { headers: auth }).then(r => r.json());
  const cid = c.data?.[0]?.id;
  if (!cid) {
    console.log("    → no controls available, skipping");
    return;
  }
  const res = await v2Handlers.listControlOwners(undefined, cid);
  if (res.isError) {
    // If the upstream returned 404, the success path is untested but the
    // error path doesn't leak `data` either.
    console.log(`    → control ${cid} returned error: "${res.error}" — shape check skipped`);
    return;
  }
  assert.equal(res.result.data, undefined);
  assert.ok(Array.isArray(res.result.controlOwners));
});

await test("listEvidenceLibrary → no top-level `data` field, has `items`", async () => {
  const res = await v2Handlers.listEvidenceLibrary();
  if (res.isError) {
    console.log(`    → evidence library gated/unavailable: ${res.error}`);
    return;
  }
  assert.equal(res.result.data, undefined);
  assert.ok(Array.isArray(res.result.items));
});

await test("listPolicyVersions → no top-level `data` field, has `versions`", async () => {
  const policies = await fetch(`${baseUrl}/public/v2/policies?size=1`, { headers: auth }).then(r => r.json());
  const pid = policies.data?.[0]?.id;
  if (!pid) {
    console.log("    → no policies, skipping");
    return;
  }
  const res = await v2Handlers.listPolicyVersions(pid);
  assert.equal(res.isError, false);
  assert.equal(res.result.data, undefined);
  assert.ok(Array.isArray(res.result.versions));
});

console.log("\n── total / returned semantics (live) ──");

await test("listEventsV2 (cursor-paginated) — `total` is null when more pages exist", async () => {
  const res = await v2Handlers.listEventsV2({ size: 5 });
  assert.equal(res.isError, false);
  assert.equal(typeof res.result.returned, "number");
  console.log(`    → returned=${res.result.returned}, total=${res.result.total}, cursor=${res.result.pagination?.cursor ? "set" : "null"}`);
  if (res.result.pagination?.cursor) {
    assert.equal(res.result.total, null, "non-null cursor must mean total=null");
  } else {
    assert.equal(res.result.total, res.result.returned);
  }
});

await test("listMonitoringTestsV2 with fetchAll — total === returned === array length", async () => {
  const res = await v2Handlers.listMonitoringTestsV2(undefined, undefined, { fetchAll: true });
  assert.equal(res.isError, false, res.error);
  assert.equal(res.result.total, res.result.returned);
  assert.equal(res.result.total, res.result.tests.length);
  console.log(`    → total=${res.result.total} === returned=${res.result.returned}`);
});

await test("listPoliciesV2 (merged) — total reflects workspace count", async () => {
  const res = await v2Handlers.listPoliciesV2();
  assert.equal(res.isError, false);
  assert.equal(res.result.total, res.result.policies.length);
  assert.equal(res.result.returned, res.result.total);
  console.log(`    → ${res.result.total} policies in workspace (merged)`);
});

// ───────────────────────────────────────────────────────────────
// list_assets totals and single-page defaults
// ───────────────────────────────────────────────────────────────

console.log("\n── list_assets totals (live) ──");

await test("list_assets total is finite, never the 9999999 sentinel", async () => {
  const { listAssets: la } = await import("../dist/handlers/list-entities.handler.js");
  const res = await la();
  assert.equal(res.isError, false, res.error);
  assert.ok(Number.isFinite(res.result.total), `total is ${res.result.total}`);
  assert.notEqual(res.result.total, 9999999, "Drata sentinel must not leak");
  console.log(`    → workspace asset count: ${res.result.total}`);
});

await test("list_assets total === get_compliance_summary.totalAssets", async () => {
  const { listAssets: la } = await import("../dist/handlers/list-entities.handler.js");
  const [assetsRes, summaryRes] = await Promise.all([la(), getComplianceSummary()]);
  assert.equal(assetsRes.isError, false);
  assert.equal(summaryRes.isError, false);
  assert.equal(
    assetsRes.result.total,
    summaryRes.result.totalAssets,
    `disagreement: list_assets=${assetsRes.result.total}, compliance-summary=${summaryRes.result.totalAssets}`,
  );
});

await test("list_assets sets hasMore when total exceeds the page", async () => {
  const { listAssets: la } = await import("../dist/handlers/list-entities.handler.js");
  const res = await la();
  if (res.result.total > res.result.returned) {
    assert.equal(res.result.hasMore, true);
  }
});

console.log("\n── list_framework_requirements default returns one page (live) ──");

await test("default call returns ≤ 20 requirements (the documented size)", async () => {
  const { listFrameworkRequirements: lfr } = await import("../dist/handlers/v2-write.handler.js");
  const res = await lfr();
  assert.equal(res.isError, false, res.error);
  assert.ok(
    res.result.requirements.length <= 20,
    `default call returned ${res.result.requirements.length} requirements; description claims one page of 20`,
  );
  console.log(`    → ${res.result.requirements.length} requirements on default page`);
});

await test("default call exposes a cursor while more requirements remain", async () => {
  const { listFrameworkRequirements: lfr } = await import("../dist/handlers/v2-write.handler.js");
  const res = await lfr();
  assert.equal(res.isError, false, res.error);
  const { returned, total, pagination } = res.result;
  if (typeof total === "number") {
    // includeTotalCount is on by default, so `total` is the workspace count.
    if (total > returned) {
      assert.ok(
        pagination.cursor,
        `total=${total} > returned=${returned}, so a cursor must be present to fetch the rest`,
      );
    }
  } else {
    assert.equal(total, null);
    assert.ok(pagination.cursor, "total is null only while more pages remain");
  }
});

await test("tool-layer default invocation also caps at 20", async () => {
  const ListFrameworkRequirementsTool = (
    await import("../dist/tools/v2/list-framework-requirements.tool.js")
  ).default();
  const out = await ListFrameworkRequirementsTool.handler({});
  const parsed = JSON.parse(out.content[0].text);
  assert.ok(
    parsed.requirements.length <= 20,
    `tool default call returned ${parsed.requirements.length}, expected ≤ 20`,
  );
});

// ───────────────────────────────────────────────────────────────
// Final summary
// ───────────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(50)}`);
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`  ✗ ${f.name}`);
    console.log(`    ${f.error}`);
  }
}
process.exit(failed > 0 ? 1 : 0);
