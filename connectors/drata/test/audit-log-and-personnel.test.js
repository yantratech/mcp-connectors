/**
 * Regression tests for two Drata connector behaviours:
 *
 *  1. (security) DRATA_MCP_AUDIT_LOG must create its file with mode 0600 and
 *     any directory it creates with mode 0700, so enabling the audit log does
 *     not drop a world-readable plaintext record of sensitive GRC data.
 *
 *  2. (ux) list_personnel / list_personnel_v2 must be compact-by-default
 *     (heavy backgroundChecks[]/documents[] arrays summarized as counts) and
 *     honor an optional fields[] projection — including restoring the full
 *     arrays when explicitly requested.
 *
 * Stands up a local mock Drata API (same pattern as the e2e/audit-fixes
 * suites) and drives the compiled handlers in dist against it.
 *
 * Run: node --test test/audit-log-and-personnel.test.js
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

/** A V1 personnel record with a nested user carrying the heavy arrays. */
function makePerson(i) {
  return {
    id: i,
    employmentStatus: "CURRENT_EMPLOYEE",
    user: {
      id: 1000 + i,
      firstName: `First${i}`,
      lastName: `Last${i}`,
      email: `user${i}@example.com`,
      jobTitle: "Engineer",
      roles: ["EMPLOYEE"],
      drataTermsAgreedAt: "2026-01-01T00:00:00.000Z",
      backgroundChecks: [
        { id: i * 10 + 1, status: "CLEARED", blob: "x".repeat(500) },
        { id: i * 10 + 2, status: "CLEARED", blob: "y".repeat(500) },
      ],
      documents: [{ id: i * 100 + 1, type: "TRAINING", blob: "z".repeat(500) }],
    },
  };
}

let server;
let baseUrl;

before(async () => {
  server = http.createServer(async (req, res) => {
    await readBody(req);
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/public/personnel") {
      const data = Array.from({ length: 3 }, (_, i) => makePerson(i + 1));
      return json(res, { data, total: data.length, page: 1, limit: 50 });
    }
    return json(res, { statusCode: 404, message: "not found" }, 404);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  process.env.DRATA_API_KEY = "test-key";
  process.env.DRATA_BASE_URL = baseUrl;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// ── DRATA_MCP_AUDIT_LOG file-mode hardening ────────────────────

describe("DRATA_MCP_AUDIT_LOG hardening", () => {
  // Permission bits are a POSIX concept; skip the mode assertions on Windows.
  const posix = process.platform !== "win32";

  it("creates the audit file 0600 and a created parent dir 0700", async (t) => {
    if (!posix) return t.skip("POSIX file modes only");

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "drata-audit-"));
    // Point the log at a *nested* dir that does not exist yet, so the client
    // has to create it and we can assert the directory mode too.
    const logDir = path.join(tmp, "nested");
    const logFile = path.join(logDir, "mutations.jsonl");
    process.env.DRATA_MCP_AUDIT_LOG = logFile;
    process.env.DRATA_MCP_DRY_RUN = "1"; // log without issuing a real request

    try {
      // Import a fresh module instance so the env is picked up, then drive a
      // mutation. createVendorType POSTs, which is a mutation -> audited.
      const mod = await import(
        `../dist/handlers/v2-write.handler.js?audit=${Date.now()}`
      );
      const resp = await mod.createVendorType({ name: "Auditors LLC" });
      assert.equal(resp.isError, false, resp.error);

      assert.ok(fs.existsSync(logFile), "audit log file should be created");
      const fileMode = fs.statSync(logFile).mode & 0o777;
      assert.equal(
        fileMode,
        0o600,
        `audit file should be 0600, got 0${fileMode.toString(8)}`,
      );
      const dirMode = fs.statSync(logDir).mode & 0o777;
      assert.equal(
        dirMode,
        0o700,
        `created audit dir should be 0700, got 0${dirMode.toString(8)}`,
      );

      // The body is recorded (this is exactly the sensitive-data concern the
      // mode restriction protects).
      const contents = fs.readFileSync(logFile, "utf8");
      assert.match(contents, /Auditors LLC/);
    } finally {
      delete process.env.DRATA_MCP_AUDIT_LOG;
      delete process.env.DRATA_MCP_DRY_RUN;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── Personnel compaction + field projection ────────────────────

describe("list_personnel projection", () => {
  it("drops heavy arrays and emits counts by default", async () => {
    const { listPersonnel } = await import(
      "../dist/handlers/list-entities.handler.js"
    );
    const resp = await listPersonnel();
    assert.equal(resp.isError, false, resp.error);
    assert.equal(resp.result.total, 3);
    const p = resp.result.personnel[0];
    // Cheap counts present…
    assert.equal(p.backgroundChecksCount, 2);
    assert.equal(p.documentsCount, 1);
    // …heavy arrays dropped.
    assert.ok(
      !("backgroundChecks" in p),
      "backgroundChecks[] must be dropped by default",
    );
    assert.ok(!("documents" in p), "documents[] must be dropped by default");
    // Useful scalar fields survive.
    assert.equal(p.firstName, "First1");
    assert.equal(p.email, "user1@example.com");
  });

  it("projects only requested fields", async () => {
    const { listPersonnel } = await import(
      "../dist/handlers/list-entities.handler.js"
    );
    const resp = await listPersonnel({ fields: ["id", "email"] });
    assert.equal(resp.isError, false, resp.error);
    const p = resp.result.personnel[0];
    assert.deepEqual(Object.keys(p).sort(), ["email", "id"]);
  });

  it("restores the full backgroundChecks[] array when named in fields", async () => {
    const { listPersonnel } = await import(
      "../dist/handlers/list-entities.handler.js"
    );
    const resp = await listPersonnel({ fields: ["id", "backgroundChecks"] });
    assert.equal(resp.isError, false, resp.error);
    const p = resp.result.personnel[0];
    assert.ok(Array.isArray(p.backgroundChecks));
    assert.equal(p.backgroundChecks.length, 2);
    assert.equal(p.backgroundChecks[0].status, "CLEARED");
  });
});

describe("list_personnel_v2 projection", () => {
  it("is compact by default and respects q", async () => {
    const { listPersonnelV2 } = await import(
      "../dist/handlers/v2-write.handler.js"
    );
    const resp = await listPersonnelV2({ q: "first2" });
    assert.equal(resp.isError, false, resp.error);
    assert.equal(resp.result.total, 1);
    const p = resp.result.personnel[0];
    assert.equal(p.firstName, "First2");
    assert.equal(p.backgroundChecksCount, 2);
    assert.ok(!("backgroundChecks" in p));
  });

  it("honors a fields[] projection", async () => {
    const { listPersonnelV2 } = await import(
      "../dist/handlers/v2-write.handler.js"
    );
    const resp = await listPersonnelV2(undefined, { fields: ["id", "documents"] });
    assert.equal(resp.isError, false, resp.error);
    const p = resp.result.personnel[0];
    assert.deepEqual(Object.keys(p).sort(), ["documents", "id"]);
    assert.equal(p.documents.length, 1);
  });
});
