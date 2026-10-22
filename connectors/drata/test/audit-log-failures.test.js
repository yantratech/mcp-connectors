/**
 * Regression tests: a DRATA_MCP_AUDIT_LOG failure must never be reported as
 * a failed mutation.
 *
 *  1. If the entry cannot be appended after Drata has applied a write, the
 *     tool still succeeds with Drata's result, plus a warning that the change
 *     was applied and must not be retried.
 *  2. If Drata rejects a write and the append fails too, the tool returns
 *     Drata's error, not the filesystem error.
 *  3. If the log cannot be written before a mutation, the tool fails without
 *     sending anything (dry runs included).
 *  4. Each warning reaches the result of the call that made the request, even
 *     when calls overlap.
 *
 * Every client path that writes the audit log is driven through a real tool:
 * V1 JSON, V2 JSON, V1 multipart form, V2 upload and both V1 uploads.
 *
 * Run: node --test test/audit-log-failures.test.js
 */
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let server;
let tmp;
let logFile;
let uploadFile;
let requests;
// Status the mock returns for mutations (GETs always get 200), and a hook it
// runs while a mutation is in flight (after it arrives, before the response).
let mutationStatus;
let duringMutation;

before(async () => {
  server = http.createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    requests.push({ method: req.method, url: req.url });
    const status = req.method === "GET" ? 200 : mutationStatus;
    if (req.method !== "GET") await duringMutation?.(req);
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        status < 300
          ? { id: 501, path: req.url }
          : { statusCode: status, message: "Validation failed" },
      ),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.DRATA_API_KEY = "test-key";
  process.env.DRATA_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.DRATA_WORKSPACE_ID = "1";
});

after(async () => {
  // Drop any request a failed test left on hold, so close() cannot hang.
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "drata-audit-fail-"));
  logFile = path.join(tmp, "audit.jsonl");
  uploadFile = path.join(tmp, "evidence.pdf");
  fs.writeFileSync(uploadFile, "%PDF-1.4 test");
  process.env.DRATA_MCP_AUDIT_LOG = logFile;
  delete process.env.DRATA_MCP_DRY_RUN;
  requests = [];
  mutationStatus = 201;
  duringMutation = undefined;
});

afterEach(() => {
  delete process.env.DRATA_MCP_AUDIT_LOG;
  delete process.env.DRATA_MCP_DRY_RUN;
  fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * Replace the log file with a directory. Called while the request is in
 * flight, so the pre-dispatch check has passed and only the append after
 * Drata's response fails (EISDIR, which also fails for root, unlike a
 * permissions change).
 */
function breakAuditLog() {
  fs.rmSync(logFile, { recursive: true, force: true });
  fs.mkdirSync(logFile);
}

/** One tool per client path that writes the audit log. */
const CASES = [
  {
    tool: "create_vendor",
    via: "V1 JSON",
    module: "../dist/tools/write/create-vendor.tool.js",
    path: "/public/vendors",
    args: () => ({
      name: "Example Vendor",
      category: "SECURITY",
      risk: "LOW",
      critical: false,
      isSubProcessor: false,
      isSubProcessorActive: false,
    }),
  },
  {
    tool: "create_control",
    via: "V2 JSON",
    module: "../dist/tools/v2/create-control.tool.js",
    path: "/public/v2/workspaces/1/controls",
    args: () => ({ name: "Example control" }),
  },
  {
    tool: "create_control_external_evidence",
    via: "V1 multipart form",
    module: "../dist/tools/write/create-control-external-evidence.tool.js",
    path: "/public/workspaces/1/controls/58/external-evidence",
    args: () => ({
      controlId: 58,
      name: "Example evidence",
      creationDate: "2026-10-01T00:00:00Z",
      renewalDate: "2027-10-01T00:00:00Z",
      renewalScheduleType: "ONE_YEAR",
      url: "https://example.com/evidence",
    }),
  },
  {
    tool: "upload_offboarding_document",
    via: "V2 upload",
    module: "../dist/tools/v2/upload-offboarding-document.tool.js",
    path: "/public/v2/users/7/documents",
    args: () => ({
      userId: 7,
      fileBase64: Buffer.from("offboarding").toString("base64"),
      fileName: "offboarding.pdf",
    }),
  },
  {
    tool: "upload_vendor_document",
    via: "V1 vendor upload",
    module: "../dist/tools/write/upload-vendor-document.tool.js",
    path: "/public/vendors/42/documents",
    args: () => ({ vendorId: 42, filePath: uploadFile }),
  },
  {
    tool: "upload_user_document",
    via: "V1 user upload",
    module: "../dist/tools/write/upload-user-document.tool.js",
    path: "/public/users/7/documents",
    args: () => ({ userId: 7, filePath: uploadFile, type: "SEC_TRAINING" }),
  },
];

async function runTool(c) {
  const { default: factory } = await import(c.module);
  return factory().handler(c.args());
}

function mutations() {
  return requests.filter((r) => r.method !== "GET");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("audit append fails after Drata applied the write", () => {
  for (const c of CASES) {
    it(`${c.tool} (${c.via}) returns Drata's result and a do-not-retry warning`, async () => {
      duringMutation = breakAuditLog;

      const result = await runTool(c);

      assert.notEqual(result.isError, true, result.content[0].text);
      assert.deepEqual(mutations(), [{ method: "POST", url: c.path }]);
      assert.deepEqual(JSON.parse(result.content[0].text), {
        id: 501,
        path: c.path,
      });
      assert.equal(result.content.length, 2);
      assert.match(
        result.content[1].text,
        new RegExp(
          `^Audit log warning: Drata applied POST ${escapeRegExp(c.path)} \\(HTTP 201\\), ` +
            `but its audit log entry could not be written \\(EISDIR[^)]*\\)\\. ` +
            `The change is in Drata; do not retry it\\.$`,
        ),
      );
    });
  }
});

describe("audit append fails after Drata rejected the write", () => {
  for (const c of CASES) {
    it(`${c.tool} (${c.via}) keeps Drata's error and adds the warning`, async () => {
      mutationStatus = 422;
      duringMutation = breakAuditLog;

      const result = await runTool(c);

      assert.equal(result.isError, true);
      assert.equal(mutations().length, 1);
      assert.match(result.content[0].text, /^Error: .*\b422\b.*Validation failed/);
      assert.doesNotMatch(result.content[0].text, /EISDIR/);
      assert.equal(result.content.length, 2);
      assert.match(
        result.content[1].text,
        new RegExp(
          `^Audit log warning: Drata rejected POST ${escapeRegExp(c.path)} \\(HTTP 422\\), ` +
            `and its audit log entry could not be written \\(EISDIR`,
        ),
      );
    });
  }
});

describe("audit log cannot be written before the mutation", () => {
  // A path whose parent is a regular file cannot be created by anyone,
  // root included.
  function pointLogUnderAFile() {
    const notADirectory = path.join(tmp, "not-a-directory");
    fs.writeFileSync(notADirectory, "");
    process.env.DRATA_MCP_AUDIT_LOG = path.join(notADirectory, "audit.jsonl");
  }

  for (const c of CASES) {
    it(`${c.tool} (${c.via}) fails before sending anything`, async () => {
      pointLogUnderAFile();

      const result = await runTool(c);

      assert.equal(result.isError, true);
      assert.deepEqual(mutations(), []);
      assert.equal(result.content.length, 1);
      assert.match(
        result.content[0].text,
        /^Error: Audit log unavailable: DRATA_MCP_AUDIT_LOG is set to ".*not-a-directory.audit\.jsonl", but it cannot be written \(.+\)\. No change was sent to Drata\./,
      );
    });
  }

  it("fails the same way in dry-run mode", async () => {
    pointLogUnderAFile();
    process.env.DRATA_MCP_DRY_RUN = "1";

    const result = await runTool(CASES[0]);

    assert.equal(result.isError, true);
    assert.deepEqual(requests, []);
    assert.match(result.content[0].text, /^Error: Audit log unavailable: /);
  });

  it("rejects a read-only log directory before sending anything", async (t) => {
    if (process.platform === "win32" || process.getuid?.() === 0) {
      return t.skip("needs POSIX permissions and a non-root user");
    }
    const readOnlyDir = path.join(tmp, "read-only");
    fs.mkdirSync(readOnlyDir, { mode: 0o500 });
    process.env.DRATA_MCP_AUDIT_LOG = path.join(readOnlyDir, "audit.jsonl");

    try {
      const result = await runTool(CASES[0]);

      assert.equal(result.isError, true);
      assert.deepEqual(requests, []);
      assert.match(
        result.content[0].text,
        /^Error: Audit log unavailable: .*\(EACCES[^)]*\)\. No change was sent to Drata\./,
      );
    } finally {
      fs.chmodSync(readOnlyDir, 0o700);
    }
  });
});

describe("audit warnings with overlapping calls", () => {
  it("attaches each warning to the call that made the request", { timeout: 10_000 }, async () => {
    // Call A (bulk_update_vendors) writes vendors 1 and 2; call B
    // (create_vendor) starts and finishes between A's two writes, so a warning
    // list shared across calls would hand A's first warning to B.
    const held = new Map();
    let allHeld;
    const threeHeld = new Promise((resolve) => (allHeld = resolve));
    duringMutation = (req) =>
      new Promise((release) => {
        held.set(`${req.method} ${req.url}`, release);
        if (held.size === 3) allHeld();
      });
    const stderr = [];
    let onStderr;
    const originalError = console.error;
    console.error = (...args) => {
      stderr.push(args.join(" "));
      onStderr?.();
    };
    const loggedFor = (request) =>
      new Promise((resolve) => {
        onStderr = () => {
          if (stderr.some((line) => line.includes(` ${request} `))) resolve();
        };
        onStderr();
      });

    try {
      const { default: bulkUpdate } = await import(
        "../dist/tools/write/bulk-update-vendors.tool.js"
      );
      const callA = bulkUpdate().handler({
        updates: [
          { vendorId: 1, notes: "first" },
          { vendorId: 2, notes: "second" },
        ],
      });
      const callB = runTool(CASES[0]);

      // Every pre-dispatch check has passed once all three writes are held.
      await threeHeld;
      breakAuditLog();
      held.get("PUT /public/vendors/1")();
      await loggedFor("PUT /public/vendors/1");
      held.get("POST /public/vendors")();
      const resultB = await callB;
      held.get("PUT /public/vendors/2")();
      const resultA = await callA;

      assert.notEqual(resultB.isError, true, resultB.content[0].text);
      assert.equal(resultB.content.length, 2);
      assert.deepEqual(
        resultB.content[1].text.split("\n").map((l) => l.match(/applied (\S+ \S+)/)?.[1]),
        ["POST /public/vendors"],
      );

      assert.notEqual(resultA.isError, true, resultA.content[0].text);
      assert.deepEqual(JSON.parse(resultA.content[0].text), {
        total: 2,
        succeeded: 2,
        failed: 0,
      });
      assert.equal(resultA.content.length, 2);
      assert.deepEqual(
        resultA.content[1].text.split("\n").map((l) => l.match(/applied (\S+ \S+)/)?.[1]),
        ["PUT /public/vendors/1", "PUT /public/vendors/2"],
      );
    } finally {
      console.error = originalError;
    }
  });
});
