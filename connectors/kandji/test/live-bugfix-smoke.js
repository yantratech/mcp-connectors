#!/usr/bin/env node
/**
 * Live smoke test against a real Kandji (Iru Endpoint) tenant, for behaviour
 * the offline suites can only simulate: ADE public-key PEM parsing, the
 * prism_count fan-out, the EDR v1/v2 fallback, Prism payload compaction,
 * "not configured" states, list response shapes and the marketing model name
 * in get_device_details.
 *
 * Read-only by default: without KANDJI_LIVE_WRITES=1 every request is a GET.
 * With KANDJI_LIVE_WRITES=1 it also creates one Prism export job, a
 * fleet-wide FileVault CSV export (POST /prism/export), to check the export
 * request body. That job is new server-side state; nothing is modified or
 * deleted.
 *
 * Usage:
 *   KANDJI_API_TOKEN=xxx KANDJI_BASE_URL=https://yourcompany.api.kandji.io/api/v1 \
 *   node test/live-bugfix-smoke.js
 *
 *   # Also create the Prism export job:
 *   KANDJI_LIVE_WRITES=1 KANDJI_API_TOKEN=xxx KANDJI_BASE_URL=... \
 *   node test/live-bugfix-smoke.js
 */
import assert from "node:assert/strict";

if (!process.env.KANDJI_API_TOKEN || !process.env.KANDJI_BASE_URL) {
  console.error(
    "Set KANDJI_API_TOKEN and KANDJI_BASE_URL env vars (e.g. https://yourcompany.api.kandji.io/api/v1).",
  );
  process.exit(1);
}

const LIVE_WRITES = process.env.KANDJI_LIVE_WRITES === "1";

const ade = await import("../dist/handlers/ade.handler.js");
const prism = await import("../dist/handlers/prism.handler.js");
const prismCount = await import("../dist/handlers/get-prism-count.handler.js");
const prismExport = await import("../dist/handlers/prism-export.handler.js");
const threats = await import("../dist/handlers/threats.handler.js");
const blueprintRouting = await import(
  "../dist/handlers/blueprint-routing.handler.js"
);
const deviceLostMode = await import(
  "../dist/handlers/get-device-lost-mode.handler.js"
);
const deviceDetails = await import(
  "../dist/handlers/get-device-details.handler.js"
);
const library = await import("../dist/handlers/library.handler.js");
const listDevices = await import("../dist/handlers/list-devices.handler.js");

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}\n    ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

const dur = (ms) => `${ms.toFixed(0)}ms`;

// Need at least one device for several tests
console.log("\n── Discovering fleet ──");
const devicesRes = await listDevices.listDevices({}, 5);
assert.equal(devicesRes.isError, false, devicesRes.error);
const sampleDeviceId = devicesRes.result.devices?.[0]?.device_id;
console.log(
  `  → ${devicesRes.result.count} devices, sample id=${sampleDeviceId ?? "(none)"}`,
);

// ─── ADE public key ──────────────────────────────────────────
console.log("\n── get_ade_public_key returns a PEM, not a JSON.parse error ──");
{
  const t0 = performance.now();
  const res = await ade.getAdePublicKey();
  await test("public_key endpoint succeeds with a PEM", () => {
    assert.equal(res.isError, false, res.error);
    assert.ok(
      typeof res.result.public_key === "string" &&
        res.result.public_key.includes("-----BEGIN"),
      "expected a PEM body in result.public_key",
    );
    console.log(`    → ${dur(performance.now() - t0)}`);
  });
}

// ─── prism_count fan-out ─────────────────────────────────────
console.log("\n── prism_count returns counts across all 16 categories ──");
{
  const t0 = performance.now();
  const res = await prismCount.getPrismCount();
  await test("prism_count fans out", () => {
    assert.equal(res.isError, false, res.error);
    const cats = Object.keys(res.result.counts);
    assert.ok(cats.length === 16, `expected 16 categories, got ${cats.length}`);
    console.log(`    → counts.apps=${res.result.counts.apps}, ${dur(performance.now() - t0)}`);
  });
}

// ─── prism_request_export request body (creates an export job) ──
console.log("\n── prism_request_export sends the required body fields ──");
if (LIVE_WRITES) {
  const res = await prismExport.requestPrismExport("filevault", {
    device_families: ["Mac"],
    blueprint_ids: ["*"],
  });
  await test("export request accepted (or returns informative error)", () => {
    if (res.isError) {
      // A 422 "field required" here means the request body is missing
      // fields the API requires.
      assert.doesNotMatch(
        res.error,
        /422.*field required/i,
        "still missing required fields",
      );
    } else {
      assert.ok(
        res.result.export_id || res.result.id,
        "expected an export_id in the response",
      );
    }
  });
} else {
  console.log(
    "  - skipped: creates a Prism export job; set KANDJI_LIVE_WRITES=1 to run it",
  );
}

// ─── EDR threats v1/v2 fallback ──────────────────────────────
console.log("\n── threats endpoints try v1 first, fall back on 404 ──");
{
  const res = await threats.getThreats({}, 5);
  await test("get_threats returns either threats or license_gated", () => {
    assert.equal(res.isError, false, res.error);
    // On a tenant without EDR, expect license_gated:true
    if (res.result.license_gated) {
      console.log("    → license_gated:true (EDR not enabled — expected)");
    } else {
      console.log(`    → ${res.result.count} threats`);
    }
  });

  const res2 = await threats.getBehavioralDetections({}, 5);
  await test("get_behavioral_detections returns events or license_gated", () => {
    assert.equal(res2.isError, false, res2.error);
    if (res2.result.license_gated) {
      console.log("    → license_gated:true (EDR not enabled — expected)");
    } else {
      console.log(`    → ${res2.result.count} events`);
    }
  });
}

// ─── Prism payload compaction ────────────────────────────────
console.log("\n── prism-* tools compact the payload ──");
for (const category of ["apps", "local_users", "transparency_database"]) {
  const t0 = performance.now();
  const res = await prism.getPrismData(category);
  await test(`${category}: <100KB on default cap`, () => {
    assert.equal(res.isError, false, res.error);
    const size = Buffer.byteLength(JSON.stringify(res.result), "utf8");
    assert.ok(size < 100 * 1024, `${category} was ${size}B, expected <100KB`);
    console.log(
      `    → ${res.result.returned} rows, ${size} bytes, ${dur(performance.now() - t0)}`,
    );
  });
}

await test("summary mode returns by_device + sample", async () => {
  const res = await prism.getPrismData("apps", { summary: true });
  assert.equal(res.isError, false, res.error);
  assert.ok(res.result.by_device);
  assert.ok(Array.isArray(res.result.sample));
});

await test("fields[] projection", async () => {
  const res = await prism.getPrismData("device_information", {
    maxResults: 5,
    fields: ["last_check_in_status"],
  });
  assert.equal(res.isError, false, res.error);
  assert.ok(Array.isArray(res.result.fields_projected));
});

// ─── "Not configured" states ─────────────────────────────────
console.log("\n── soft-handle 'not configured' states ──");
{
  const res = await blueprintRouting.getBlueprintRouting();
  await test("blueprint-routing returns configured: bool, never errors on 404", () => {
    assert.equal(res.isError, false, res.error);
    assert.ok(typeof res.result.configured === "boolean");
    console.log(`    → configured=${res.result.configured}`);
  });

  if (sampleDeviceId) {
    const lostRes = await deviceLostMode.getDeviceLostMode(sampleDeviceId);
    await test("device-lost-mode returns lost_mode_enabled instead of erroring", () => {
      assert.equal(lostRes.isError, false, lostRes.error);
      assert.ok(typeof lostRes.result.lost_mode_enabled === "boolean");
      console.log(`    → lost_mode_enabled=${lostRes.result.lost_mode_enabled}`);
    });
  }
}

// ─── List response shapes ────────────────────────────────────
console.log("\n── list-* responses carry one array key ──");
{
  const ca = await library.listCustomApps();
  await test("list_custom_apps has `results`, not `items`", () => {
    assert.equal(ca.isError, false, ca.error);
    assert.ok(Array.isArray(ca.result.results));
    assert.equal(ca.result.items, undefined);
  });

  // list_devices carries exactly one array key, `devices`, with no `results`
  // alias (matches the e2e.test.js list-shape tests).
  await test("list_devices has `devices` only (no `results` alias)", () => {
    assert.ok(Array.isArray(devicesRes.result.devices));
    assert.equal(devicesRes.result.results, undefined);
  });
}

// ─── get_device_details model name ───────────────────────────
console.log("\n── get_device_details enriches model_name ──");
if (sampleDeviceId) {
  const res = await deviceDetails.getDeviceDetails(sampleDeviceId);
  await test("hardware_overview.model_name is the marketing name when available", () => {
    assert.equal(res.isError, false, res.error);
    const mn = res.result?.hardware_overview?.model_name;
    if (typeof mn === "string") {
      assert.ok(
        mn.length > 3 && !/^Mac$|^iPhone$|^iPad$/.test(mn),
        `expected a marketing model name, got "${mn}"`,
      );
      console.log(`    → model_name="${mn}"`);
    } else {
      console.log("    → no model_name (skipped)");
    }
  });
}

// ─── Summary ──────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}
