#!/usr/bin/env node
/**
 * Live-tenant integration tests for the Kandji write surface.
 *
 * These tests actually create, update, and delete resources against the
 * configured Kandji tenant — they are not unit tests and they intentionally
 * sit outside `npm test` so CI never runs them by accident.
 *
 * Gated behind KANDJI_LIVE_WRITES=1 so it is impossible to run without an
 * explicit opt-in. If the gate isn't set the script exits 0 silently so a
 * `for f in test/live-*.js; do node "$f"; done` driver still completes
 * cleanly on a developer machine without credentials.
 *
 * Run with:
 *   KANDJI_API_TOKEN=… \
 *   KANDJI_BASE_URL=https://yourcompany.api.eu.kandji.io/api/v1 \
 *   KANDJI_LIVE_WRITES=1 \
 *   node test/live-write-tools.test.js
 *
 * Test artefacts use the prefix `zz-mcp-livetest-` so they sort to the
 * bottom of the Kandji UI and are easy to identify and clean up if a test
 * crashes mid-flight. The `finally` block deletes anything it created.
 *
 * Device actions (NOT executed live):
 *   The destructive device-action verbs (erase, lock, deleteuser, …) are
 *   intentionally OUT OF SCOPE for this harness — calling /erase against a
 *   real device would wipe it. Wire-format coverage for those tools lives
 *   in `test/e2e.test.js` against a mock Kandji server, which is sufficient
 *   to validate the request shape Kandji's serializer expects (e.g. that
 *   erase_device sends the required uppercase `PIN` key). If you need to
 *   reverify against the live API on a sacrificial device, do it manually
 *   from a one-off script — never from this CI-friendly harness.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const TOKEN = process.env.KANDJI_API_TOKEN;
const BASE = process.env.KANDJI_BASE_URL;
const ENABLED = process.env.KANDJI_LIVE_WRITES === "1";

if (!TOKEN || !BASE || !ENABLED) {
  console.log(
    "[live-write-tools] Skipped — set KANDJI_API_TOKEN, KANDJI_BASE_URL, KANDJI_LIVE_WRITES=1 to run.",
  );
  process.exit(0);
}

// Built distribution — same code path the MCP server uses.
const blueprintWrite = await import("../dist/handlers/blueprint-write.handler.js");
const libraryWrite = await import("../dist/handlers/library-write.handler.js");

const SUFFIX =
  Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
const PREFIX = `zz-mcp-livetest-${SUFFIX}`;

let passed = 0;
let failed = 0;
const cleanup = []; // array of () => Promise<void>

const test = async (name, fn) => {
  process.stdout.write(`  ▸ ${name}… `);
  try {
    await fn();
    console.log("ok");
    passed++;
  } catch (err) {
    console.log(`FAIL\n      ${err.message}`);
    failed++;
  }
};

// Kandji rewrites standard MDM keys (PayloadDisplayName, PayloadIdentifier,
// PayloadUUID) on upload but preserves any custom keys, so we embed a
// `CustomMarker` to verify the uploaded payload made it through unchanged.
const minimalMobileconfig = (marker) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CustomMarker</key>
  <string>${marker}</string>
  <key>PayloadDisplayName</key>
  <string>${marker}</string>
  <key>PayloadIdentifier</key>
  <string>com.yantra.mcptest.${randomUUID()}</string>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${randomUUID()}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`;

try {
  // ─── Blueprints ────────────────────────────────────────────
  console.log("\n── Blueprint write surface ──");
  let bpId;
  await test("create_blueprint (form-encoded, type=map default)", async () => {
    const res = await blueprintWrite.createBlueprint({
      name: `${PREFIX}-bp`,
      type: "map",
      enrollment_code: { is_active: true },
    });
    assert.equal(res.isError, false, res.error);
    assert.match(res.result.id, /^[0-9a-f-]{36}$/);
    assert.equal(res.result.name, `${PREFIX}-bp`);
    assert.equal(res.result.type, "map");
    assert.match(res.result.enrollment_code.code, /^\d{6}$/);
    bpId = res.result.id;
    cleanup.push(() => blueprintWrite.deleteBlueprint(bpId));
  });

  await test("update_blueprint (PATCH JSON)", async () => {
    const res = await blueprintWrite.updateBlueprint(bpId, {
      description: "live-write-tools description",
    });
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.description, "live-write-tools description");
  });

  // ─── Custom Scripts ────────────────────────────────────────
  console.log("\n── Custom Script write surface ──");
  let scriptId;
  await test("create_custom_script (JSON, field=script not audit_script)", async () => {
    const res = await libraryWrite.createCustomScript({
      name: `${PREFIX}-script`,
      script: "#!/bin/bash\nexit 0",
      execution_frequency: "once",
    });
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.script, "#!/bin/bash\nexit 0");
    assert.equal(res.result.execution_frequency, "once");
    scriptId = res.result.id;
    cleanup.push(() => libraryWrite.deleteCustomScript(scriptId));
  });

  await test("update_custom_script (PATCH JSON)", async () => {
    const res = await libraryWrite.updateCustomScript(scriptId, {
      remediation_script: "#!/bin/bash\necho remediated",
    });
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.remediation_script, "#!/bin/bash\necho remediated");
  });

  // ─── Custom Profiles (multipart) ───────────────────────────
  console.log("\n── Custom Profile write surface ──");
  let profileId;
  await test("create_custom_profile (multipart with file part)", async () => {
    const marker = `MARKER-CREATE-${SUFFIX}`;
    const res = await libraryWrite.createCustomProfile({
      name: `${PREFIX}-profile`,
      mobileconfig: minimalMobileconfig(marker),
      runs_on_mac: true,
    });
    assert.equal(res.isError, false, res.error);
    assert.match(res.result.id, /^[0-9a-f-]{36}$/);
    assert.equal(res.result.runs_on_mac, true);
    assert.equal(res.result.runs_on_iphone, false);
    // Kandji rewrites PayloadDisplayName/Identifier on upload but preserves
    // custom keys — see CustomMarker.
    assert.ok(
      res.result.profile.includes(marker),
      "expected the CustomMarker to round-trip through Kandji's rewrite",
    );
    profileId = res.result.id;
    cleanup.push(() => libraryWrite.deleteCustomProfile(profileId));
  });

  await test("update_custom_profile (rename only → JSON PATCH)", async () => {
    const res = await libraryWrite.updateCustomProfile(profileId, {
      name: `${PREFIX}-profile-renamed`,
    });
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.name, `${PREFIX}-profile-renamed`);
  });

  await test("update_custom_profile (replace mobileconfig → multipart PATCH)", async () => {
    const marker = `MARKER-PATCH-${SUFFIX}`;
    const res = await libraryWrite.updateCustomProfile(profileId, {
      mobileconfig: minimalMobileconfig(marker),
    });
    assert.equal(res.isError, false, res.error);
    // Verify the replacement actually landed by looking for our custom
    // marker — Kandji rewrites the standard payload metadata.
    assert.ok(
      res.result.profile.includes(marker),
      "expected the replacement CustomMarker in the stored profile",
    );
  });

  // ─── Blueprint ↔ library item assignment ────────────────────
  console.log("\n── Blueprint ↔ library item assignment ──");
  await test("assign_library_item (script → blueprint)", async () => {
    const res = await blueprintWrite.assignLibraryItemToBlueprint(
      bpId,
      scriptId,
    );
    assert.equal(res.isError, false, res.error);
  });

  await test("remove_library_item (script ← blueprint)", async () => {
    const res = await blueprintWrite.removeLibraryItemFromBlueprint(
      bpId,
      scriptId,
    );
    assert.equal(res.isError, false, res.error);
  });

  // ─── Custom App / In-House App upload step ─────────────────
  // We only exercise step 1 (request presigned URL) because the actual S3
  // binary upload is out of scope for the MCP wrapper.
  console.log("\n── Library upload presigning (S3 step 1 of 2) ──");
  await test("request-custom-app-upload (POST /library/custom-apps/upload, field=name)", async () => {
    const res = await libraryWrite.requestCustomAppUpload(`${PREFIX}-app.pkg`);
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.name, `${PREFIX}-app.pkg`);
    assert.ok(res.result.file_key.length > 0);
    assert.ok(res.result.post_url.startsWith("https://"));
    assert.ok(res.result.post_data["x-amz-signature"]);
  });

  await test("request-in-house-app-upload (POST /library/ipa-apps/upload, field=filename)", async () => {
    const res = await libraryWrite.requestInHouseAppUpload(`${PREFIX}-app.ipa`);
    assert.equal(res.isError, false, res.error);
    // Asymmetric API: ipa-apps echoes `filename`, custom-apps echoes `name`.
    assert.equal(res.result.filename, `${PREFIX}-app.ipa`);
    assert.ok(res.result.file_key.length > 0);
    assert.ok(res.result.post_url.startsWith("https://"));
  });
} finally {
  console.log("\n── Cleanup ──");
  for (const fn of cleanup.reverse()) {
    try {
      const res = await fn();
      if (res?.isError) {
        console.error(`  ! cleanup error: ${res.error}`);
      } else {
        console.log("  ✓ cleaned up");
      }
    } catch (err) {
      console.error(`  ! cleanup threw: ${err.message}`);
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
