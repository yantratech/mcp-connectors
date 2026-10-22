#!/usr/bin/env node
/**
 * Live smoke test — calls the actual Drata API through our handlers.
 * Validates that list_personnel_v2 returns real names and q search works.
 * Read-only: every call it makes is a GET.
 *
 * Usage: DRATA_API_KEY=xxx DRATA_BASE_URL=https://public-api.eu.drata.com node test/live-smoke.js
 */
import assert from "node:assert/strict";

const API_KEY = process.env.DRATA_API_KEY;
if (!API_KEY) {
  console.error("Set DRATA_API_KEY env var");
  process.exit(1);
}

const { listPersonnel } = await import("../dist/handlers/list-entities.handler.js");
const { listPersonnelV2, resolvePersonnelIdByEmail } = await import(
  "../dist/handlers/v2-write.handler.js"
);
const { checkPersonnel } = await import("../dist/handlers/check-personnel.handler.js");

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    failed++;
  }
}

console.log("\n── list_personnel (V1) ──");
const v1 = await listPersonnel();
await test("returns data without error", () => {
  assert.equal(v1.isError, false);
  assert.ok(v1.result.total > 0, `Expected personnel, got ${v1.result.total}`);
});
await test("first record has firstName", () => {
  const p = v1.result.personnel[0];
  assert.ok(p.firstName, `firstName is ${JSON.stringify(p.firstName)}`);
  assert.ok(p.lastName, `lastName is ${JSON.stringify(p.lastName)}`);
  assert.ok(p.email, `email is ${JSON.stringify(p.email)}`);
  console.log(`    → ${p.firstName} ${p.lastName} <${p.email}>`);
});
await test("no record has firstName=null (except null-user edge case)", () => {
  const withNames = v1.result.personnel.filter((p) => p.userId !== null);
  const nullNames = withNames.filter((p) => p.firstName === null);
  assert.equal(nullNames.length, 0, `${nullNames.length} records have null firstName despite having userId`);
});

console.log("\n── list_personnel_v2 ──");
const v2 = await listPersonnelV2();
await test("returns data without error", () => {
  assert.equal(v2.isError, false);
  assert.ok(v2.result.total > 0, `Expected personnel, got ${v2.result.total}`);
});
await test("first record has firstName (not null)", () => {
  const p = v2.result.personnel[0];
  assert.ok(p.firstName !== null, `firstName is null`);
  assert.ok(p.lastName !== null, `lastName is null`);
  assert.ok(p.email !== null, `email is null`);
  console.log(`    → ${p.firstName} ${p.lastName} <${p.email}>`);
});
await test("V1 and V2 return same personnel count", () => {
  assert.equal(v1.result.total, v2.result.total,
    `V1 returned ${v1.result.total}, V2 returned ${v2.result.total}`);
});

console.log("\n── list_personnel_v2 q search ──");
// Find a name to search for from V1 data
const searchName = v1.result.personnel.find((p) => p.firstName)?.firstName;
if (searchName) {
  const qRes = await listPersonnelV2({ q: searchName });
  await test(`q="${searchName}" returns results`, () => {
    assert.ok(qRes.result.total > 0, `q="${searchName}" returned 0 results`);
    console.log(`    → found ${qRes.result.total} match(es)`);
  });
  await test("matched record has the searched name", () => {
    const match = qRes.result.personnel[0];
    assert.ok(
      match.firstName.toLowerCase().includes(searchName.toLowerCase()) ||
      match.lastName.toLowerCase().includes(searchName.toLowerCase()) ||
      match.email.toLowerCase().includes(searchName.toLowerCase()),
      `Match doesn't contain "${searchName}": ${JSON.stringify(match)}`,
    );
  });
}

const noRes = await listPersonnelV2({ q: "zzz_nonexistent_person_12345" });
await test("q with nonexistent name returns 0", () => {
  assert.equal(noRes.result.total, 0, `Expected 0, got ${noRes.result.total}`);
});

console.log("\n── resolvePersonnelIdByEmail ──");
const knownEmail = v1.result.personnel.find((p) => p.email)?.email;
if (knownEmail) {
  await test(`resolves ${knownEmail} to a personnel ID`, async () => {
    const id = await resolvePersonnelIdByEmail(knownEmail);
    assert.ok(typeof id === "number" && id > 0, `Got ${id}`);
    console.log(`    → personnelId=${id}`);
  });
}
await test("throws for unknown email", async () => {
  await assert.rejects(
    () => resolvePersonnelIdByEmail("nobody_zzz@nonexistent.example"),
    { message: /No personnel found/ },
  );
});

console.log("\n── check_personnel_compliance ──");
const cp = await checkPersonnel();
await test("returns data", () => {
  assert.equal(cp.isError, false);
  assert.ok(cp.result.totalPersonnel > 0);
});
await test("personnel have real names (not undefined)", () => {
  const withUser = cp.result.personnel.filter((p) => p.userId !== null);
  const bad = withUser.filter((p) => !p.firstName || p.firstName === "undefined");
  assert.equal(bad.length, 0,
    `${bad.length} records have missing/undefined firstName: ${JSON.stringify(bad.map((p) => ({ id: p.id, firstName: p.firstName })))}`);
});

console.log(`\n${"═".repeat(40)}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
