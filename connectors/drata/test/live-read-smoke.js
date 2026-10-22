#!/usr/bin/env node
/**
 * Optional read-only live smoke for expanded Drata API coverage.
 *
 * Usage:
 *   DRATA_API_KEY=xxx DRATA_BASE_URL=https://public-api.eu.drata.com npm run smoke:read
 */

if (!process.env.DRATA_API_KEY) {
  console.log("Skipping live read smoke: DRATA_API_KEY is not set.");
  process.exit(0);
}

const {
  listEvidenceLibrary,
  listTasks,
  listWorkspaces,
} = await import("../dist/handlers/v2-write.handler.js");

const checks = [
  ["list_workspaces", () => listWorkspaces()],
  ["list_evidence_library", () => listEvidenceLibrary(undefined, { size: 5 })],
  ["list_tasks", () => listTasks(undefined, { size: 5 })],
];

let failures = 0;

for (const [name, fn] of checks) {
  const result = await fn();
  if (result.isError) {
    failures++;
    console.error(`${name}: ${result.error}`);
  } else {
    console.log(`${name}: ok`);
  }
}

process.exit(failures > 0 ? 1 : 0);
