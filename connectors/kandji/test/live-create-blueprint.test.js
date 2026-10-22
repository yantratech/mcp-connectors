#!/usr/bin/env node
/**
 * Live-tenant integration test for create_blueprint.
 *
 * Gated behind KANDJI_LIVE_WRITES=1 so it never runs in CI by accident.
 * This test actually creates a blueprint against the configured Kandji
 * tenant and deletes it on the way out — it is not a unit test.
 *
 * Run with:
 *   KANDJI_API_TOKEN=… KANDJI_BASE_URL=https://…/api/v1 KANDJI_LIVE_WRITES=1 \
 *     node test/live-create-blueprint.test.js
 *
 * Skips (exit 0) if any of the env vars above are missing — keeps `npm test`
 * green and lets CI invoke the file unconditionally without surprises.
 */
import assert from "node:assert/strict";

const TOKEN = process.env.KANDJI_API_TOKEN;
const BASE = process.env.KANDJI_BASE_URL;
const ENABLED = process.env.KANDJI_LIVE_WRITES === "1";

if (!TOKEN || !BASE || !ENABLED) {
  console.log(
    "[live-create-blueprint] Skipped — set KANDJI_API_TOKEN, KANDJI_BASE_URL, KANDJI_LIVE_WRITES=1 to run.",
  );
  process.exit(0);
}

const blueprintWrite = await import("../dist/handlers/blueprint-write.handler.js");
const createTool = (
  await import("../dist/tools/blueprints/create-blueprint.tool.js")
).default();

const suffix =
  Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
const NAME = `zz-mcp-livetest-${suffix}`;

let createdId = null;
let failed = false;

try {
  console.log(`→ Creating blueprint name="${NAME}" via tool layer…`);
  const out = await createTool.handler({ name: NAME }, {});
  assert.equal(out.content[0].type, "text");
  assert.ok(
    !out.content[0].text.startsWith("Error"),
    `tool returned an error: ${out.content[0].text}`,
  );

  const created = JSON.parse(out.content[0].text);
  assert.match(
    created.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    "expected a UUID in the created blueprint id",
  );
  assert.equal(created.name, NAME, "name round-trips");
  assert.equal(created.type, "map", "wrapper should default type to map");
  assert.ok(
    created.enrollment_code &&
      typeof created.enrollment_code.code === "string" &&
      /^\d{6}$/.test(created.enrollment_code.code),
    "enrollment_code.code must be a server-generated 6-digit string",
  );
  assert.equal(
    created.enrollment_code.is_active,
    true,
    "enrollment_code.is_active should be true by default",
  );

  createdId = created.id;
  console.log(`  ✓ created id=${createdId} code=${created.enrollment_code.code}`);

  // A second create with explicit enrollment_code: ensure the API honours it.
  // Code must be unique on the tenant — generate a random 6-digit so reruns
  // don't collide with each other.
  const NAME2 = `${NAME}-explicit`;
  const explicitCode = String(100000 + Math.floor(Math.random() * 900000));
  console.log(`→ Creating blueprint name="${NAME2}" code=${explicitCode}…`);
  const out2 = await createTool.handler(
    { name: NAME2, enrollment_code: explicitCode },
    {},
  );
  assert.ok(
    !out2.content[0].text.startsWith("Error"),
    `explicit-code tool call returned an error: ${out2.content[0].text}`,
  );
  const created2 = JSON.parse(out2.content[0].text);
  assert.equal(created2.enrollment_code.code, explicitCode);
  console.log(`  ✓ created id=${created2.id} code=${created2.enrollment_code.code}`);

  // Always delete the second blueprint regardless of further assertions.
  const del2 = await blueprintWrite.deleteBlueprint(created2.id);
  assert.equal(del2.isError, false, `cleanup failed: ${del2.error}`);
  console.log(`  ✓ deleted ${created2.id}`);
} catch (err) {
  failed = true;
  console.error(`✗ live-create-blueprint failed: ${err.message}`);
  console.error(err.stack);
} finally {
  if (createdId) {
    const del = await blueprintWrite.deleteBlueprint(createdId);
    if (del.isError) {
      console.error(
        `‼ FAILED to clean up blueprint ${createdId}: ${del.error}\n` +
          `  Please delete manually via the Kandji web UI.`,
      );
      failed = true;
    } else {
      console.log(`  ✓ deleted ${createdId}`);
    }
  }
}

if (failed) process.exit(1);
console.log("\n✅ live-create-blueprint passed");
