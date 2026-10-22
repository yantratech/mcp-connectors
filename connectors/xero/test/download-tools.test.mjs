/**
 * Offline tests for the download tool family and its binary-output helper.
 *
 * Three layers, none of which require a Xero account:
 *
 * 1. saveBinaryResponse unit tests — pure fs logic exercised against a
 *    temporary directory (absolute-path discipline, parent-dir checks,
 *    overwrite semantics, directory targets).
 * 2. zod input-schema validation for the four download-family tools,
 *    imported from compiled dist/ (handlers never invoked).
 * 3. Error-shape checks: handlers invoked with dummy credentials against a
 *    loopback stand-in for Xero's token endpoint
 *    (test/helpers/loopback-token-endpoint.mjs) that rejects them, so the
 *    token exchange fails before any Xero call or file write, with no
 *    network access; every tool
 *    must return isError: true with a single text content item, and must
 *    not have written anything to the requested outputPath.
 *
 * Run via `npm test` (node --test test/*.test.mjs) after `npm run build`.
 */
process.env.XERO_CLIENT_ID = "offline-test-id";
process.env.XERO_CLIENT_SECRET = "offline-test-secret";
process.env.XERO_CLIENT_BEARER_TOKEN = "";

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import { startRejectingTokenEndpoint } from "./helpers/loopback-token-endpoint.mjs";

// Dynamic imports so the env assignments above run first (static imports
// are hoisted ahead of them).
const { saveBinaryResponse } = await import(
  "../dist/helpers/save-binary-response.js"
);
const { default: downloadDocumentPdfFactory } = await import(
  "../dist/tools/download/download-document-pdf.tool.js"
);
const { default: getInvoiceOnlineUrlFactory } = await import(
  "../dist/tools/download/get-invoice-online-url.tool.js"
);
const { default: downloadAttachmentFactory } = await import(
  "../dist/tools/download/download-attachment.tool.js"
);
const { default: downloadFileContentFactory } = await import(
  "../dist/tools/download/download-file-content.tool.js"
);
const { xeroClient } = await import("../dist/clients/xero-client.js");

let tmpDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xero-download-test-"));
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("saveBinaryResponse helper", () => {
  it("writes a Buffer to an absolute path and reports its size", () => {
    const target = path.join(tmpDir, "write-basic.bin");
    const data = Buffer.from("hello xero");

    const saved = saveBinaryResponse(target, data);

    assert.equal(saved.path, target);
    assert.equal(saved.sizeBytes, data.length);
    assert.deepEqual(fs.readFileSync(target), data);
  });

  it("round-trips binary bytes exactly", () => {
    const target = path.join(tmpDir, "write-binary.bin");
    const data = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x01]);

    saveBinaryResponse(target, data);

    assert.deepEqual(fs.readFileSync(target), data);
  });

  it("rejects a relative outputPath", () => {
    assert.throws(
      () => saveBinaryResponse("relative/file.bin", Buffer.from("x")),
      /absolute/,
    );
  });

  it("rejects an empty outputPath", () => {
    assert.throws(() => saveBinaryResponse("", Buffer.from("x")), /absolute/);
  });

  it("rejects a missing parent directory", () => {
    const target = path.join(tmpDir, "no-such-dir", "file.bin");
    assert.throws(
      () => saveBinaryResponse(target, Buffer.from("x")),
      /Parent directory does not exist/,
    );
    assert.equal(fs.existsSync(target), false);
  });

  it("rejects a parent path that is a file, not a directory", () => {
    const parentFile = path.join(tmpDir, "parent-is-a-file");
    fs.writeFileSync(parentFile, "occupied");
    const target = path.join(parentFile, "child.bin");
    assert.throws(
      () => saveBinaryResponse(target, Buffer.from("x")),
      /Parent directory does not exist/,
    );
  });

  it("rejects an outputPath that is an existing directory", () => {
    const dirTarget = path.join(tmpDir, "i-am-a-directory");
    fs.mkdirSync(dirTarget);
    assert.throws(
      () => saveBinaryResponse(dirTarget, Buffer.from("x")),
      /directory, not a file/,
    );
  });

  it("refuses to replace an existing file by default and preserves it", () => {
    const target = path.join(tmpDir, "existing-default.bin");
    fs.writeFileSync(target, "original");
    assert.throws(
      () => saveBinaryResponse(target, Buffer.from("replacement")),
      /already exists/,
    );
    assert.equal(fs.readFileSync(target, "utf8"), "original");
  });

  it("refuses to replace an existing file when overwrite is false", () => {
    const target = path.join(tmpDir, "existing-explicit-false.bin");
    fs.writeFileSync(target, "original");
    assert.throws(
      () => saveBinaryResponse(target, Buffer.from("replacement"), false),
      /already exists/,
    );
    assert.equal(fs.readFileSync(target, "utf8"), "original");
  });

  it("replaces an existing file when overwrite is true", () => {
    const target = path.join(tmpDir, "existing-overwrite.bin");
    fs.writeFileSync(target, "original");

    const saved = saveBinaryResponse(target, Buffer.from("new bytes"), true);

    assert.equal(saved.sizeBytes, Buffer.from("new bytes").length);
    assert.equal(fs.readFileSync(target, "utf8"), "new bytes");
  });

  it("refuses a symlink outputPath and leaves its target untouched", () => {
    const victim = path.join(tmpDir, "symlink-victim.txt");
    fs.writeFileSync(victim, "precious");
    const link = path.join(tmpDir, "symlink-to-victim.bin");
    fs.symlinkSync(victim, link);
    for (const overwrite of [false, true]) {
      assert.throws(
        () => saveBinaryResponse(link, Buffer.from("attacker"), overwrite),
        /symbolic link/,
        `overwrite=${overwrite}`,
      );
    }
    assert.equal(fs.readFileSync(victim, "utf8"), "precious");
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  });

  it("refuses a dangling symlink instead of creating its target", () => {
    const missingTarget = path.join(tmpDir, "dangling-target.bin");
    const link = path.join(tmpDir, "dangling-link.bin");
    fs.symlinkSync(missingTarget, link);
    for (const overwrite of [false, true]) {
      assert.throws(
        () => saveBinaryResponse(link, Buffer.from("x"), overwrite),
        /symbolic link/,
        `overwrite=${overwrite}`,
      );
    }
    assert.equal(fs.existsSync(missingTarget), false);
  });

  it("refuses a non-regular file such as a FIFO", (t) => {
    const fifo = path.join(tmpDir, "fifo.bin");
    try {
      execFileSync("mkfifo", [fifo]);
    } catch {
      t.skip("mkfifo unavailable");
      return;
    }
    assert.throws(
      () => saveBinaryResponse(fifo, Buffer.from("x"), true),
      /not a regular file/,
    );
  });

  it("overwrite replaces the file atomically and leaves no temp files behind", () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, "atomic-"));
    const target = path.join(dir, "doc.pdf");
    fs.writeFileSync(target, "old");
    const inodeBefore = fs.statSync(target).ino;
    saveBinaryResponse(target, Buffer.from("new"), true);
    assert.equal(fs.readFileSync(target, "utf8"), "new");
    // temp-then-rename produces a new inode (an in-place write would not)
    assert.notEqual(fs.statSync(target).ino, inodeBefore);
    assert.deepEqual(fs.readdirSync(dir), ["doc.pdf"]);
  });

  it("overwrite keeps the replaced file's permission bits", () => {
    const target = path.join(tmpDir, "private.pdf");
    fs.writeFileSync(target, "old");
    fs.chmodSync(target, 0o600);
    saveBinaryResponse(target, Buffer.from("new"), true);
    assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  });

  it("refuses to overwrite a read-only file and leaves it unchanged", (t) => {
    if (process.getuid?.() === 0) {
      t.skip("root bypasses file permission checks");
      return;
    }
    const dir = fs.mkdtempSync(path.join(tmpDir, "readonly-"));
    const target = path.join(dir, "locked.pdf");
    fs.writeFileSync(target, "old");
    fs.chmodSync(target, 0o444);
    assert.throws(
      () => saveBinaryResponse(target, Buffer.from("new"), true),
      /not writable/,
    );
    assert.equal(fs.readFileSync(target, "utf8"), "old");
    assert.equal(fs.statSync(target).mode & 0o777, 0o444);
    assert.deepEqual(fs.readdirSync(dir), ["locked.pdf"]);
  });

  it("overwrites a file whose name is near NAME_MAX", () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, "longname-"));
    const target = path.join(dir, `${"a".repeat(240)}.pdf`);
    fs.writeFileSync(target, "old");
    saveBinaryResponse(target, Buffer.from("new"), true);
    assert.equal(fs.readFileSync(target, "utf8"), "new");
  });

  it("creates new files with exclusive-create (wx) semantics", () => {
    const target = path.join(tmpDir, "exclusive.bin");
    const realWrite = fs.writeFileSync;
    const flags = [];
    fs.writeFileSync = (p, d, opts) => {
      flags.push(opts?.flag);
      return realWrite(p, d, opts);
    };
    try {
      saveBinaryResponse(target, Buffer.from("x"));
    } finally {
      fs.writeFileSync = realWrite;
    }
    assert.deepEqual(flags, ["wx"]);
  });
});

const schemaOf = (factory) => z.object(factory().schema);

const accepts = (schema, input, message) =>
  assert.equal(schema.safeParse(input).success, true, message);
const rejects = (schema, input, message) =>
  assert.equal(schema.safeParse(input).success, false, message);

const ABS_PATH = path.join(os.tmpdir(), "schema-check-output.bin");

describe("download_document_pdf schema", () => {
  const s = schemaOf(downloadDocumentPdfFactory);
  const base = { documentId: "d-1", outputPath: ABS_PATH };

  it("accepts all four documentType values", () => {
    for (const documentType of [
      "invoice",
      "credit_note",
      "quote",
      "purchase_order",
    ]) {
      accepts(s, { ...base, documentType }, documentType);
    }
  });

  it("rejects a garbage documentType", () => {
    rejects(s, { ...base, documentType: "receipt" });
    rejects(s, { ...base, documentType: "" });
  });

  it("rejects relative and empty outputPaths", () => {
    rejects(s, { ...base, documentType: "invoice", outputPath: "out.pdf" });
    rejects(s, { ...base, documentType: "invoice", outputPath: "" });
  });

  it("rejects a missing outputPath", () => {
    rejects(s, { documentType: "invoice", documentId: "d-1" });
  });

  it("accepts an optional boolean overwrite and rejects a non-boolean one", () => {
    accepts(s, { ...base, documentType: "invoice", overwrite: true });
    rejects(s, { ...base, documentType: "invoice", overwrite: "yes" });
  });
});

describe("download_attachment schema", () => {
  const s = schemaOf(downloadAttachmentFactory);
  const base = {
    entityId: "e-1",
    attachmentId: "a-1",
    outputPath: ABS_PATH,
  };

  it("accepts all eleven entityType values", () => {
    for (const entityType of [
      "invoices",
      "contacts",
      "manualJournals",
      "bankTransactions",
      "creditNotes",
      "quotes",
      "receipts",
      "accounts",
      "purchaseOrders",
      "bankTransfers",
      "repeatingInvoices",
    ]) {
      accepts(s, { ...base, entityType }, entityType);
    }
  });

  it("rejects a garbage entityType", () => {
    rejects(s, { ...base, entityType: "payslips" });
  });

  it("rejects a relative outputPath", () => {
    rejects(s, { ...base, entityType: "invoices", outputPath: "a.bin" });
  });

  it("rejects a missing attachmentId", () => {
    rejects(s, {
      entityType: "invoices",
      entityId: "e-1",
      outputPath: ABS_PATH,
    });
  });
});

describe("download_file_content schema", () => {
  const s = schemaOf(downloadFileContentFactory);

  it("accepts a valid input", () => {
    accepts(s, { fileId: "f-1", outputPath: ABS_PATH });
    accepts(s, { fileId: "f-1", outputPath: ABS_PATH, overwrite: false });
  });

  it("rejects a missing fileId", () => {
    rejects(s, { outputPath: ABS_PATH });
  });

  it("rejects relative and empty outputPaths", () => {
    rejects(s, { fileId: "f-1", outputPath: "relative.bin" });
    rejects(s, { fileId: "f-1", outputPath: "" });
  });
});

describe("get_invoice_online_url schema", () => {
  const s = schemaOf(getInvoiceOnlineUrlFactory);

  it("accepts a valid invoiceId", () => {
    accepts(s, { invoiceId: "i-1" });
  });

  it("rejects a missing invoiceId", () => {
    rejects(s, {});
    rejects(s, { invoiceId: 42 });
  });
});

function assertErrorResult(result, toolName) {
  assert.equal(
    result.isError,
    true,
    `${toolName}: error results must set isError: true`,
  );
  assert.ok(
    Array.isArray(result.content),
    `${toolName}: content must be an array`,
  );
  assert.equal(
    result.content.length,
    1,
    `${toolName}: error results must carry a single content item`,
  );
  assert.equal(
    result.content[0].type,
    "text",
    `${toolName}: error content must be of type text`,
  );
  assert.equal(
    typeof result.content[0].text,
    "string",
    `${toolName}: error text must be a string`,
  );
  assert.ok(
    result.content[0].text.length > 0,
    `${toolName}: error text must not be empty`,
  );
}

describe("download tools error result convention", () => {
  const NIL_ID = "00000000-0000-0000-0000-000000000000";
  let endpoint;

  before(async () => {
    endpoint = await startRejectingTokenEndpoint(xeroClient);
  });

  after(async () => {
    await endpoint.stop();
  });

  // outputPath is supplied per-case so we can also assert that nothing is
  // written when authentication fails (the write happens after the fetch).
  const CASES = [
    [
      downloadDocumentPdfFactory,
      (outputPath) => ({
        documentType: "invoice",
        documentId: NIL_ID,
        outputPath,
      }),
    ],
    [getInvoiceOnlineUrlFactory, () => ({ invoiceId: NIL_ID })],
    [
      downloadAttachmentFactory,
      (outputPath) => ({
        entityType: "invoices",
        entityId: NIL_ID,
        attachmentId: NIL_ID,
        outputPath,
      }),
    ],
    [
      downloadFileContentFactory,
      (outputPath) => ({ fileId: NIL_ID, outputPath }),
    ],
  ];

  for (const [factory, makeArgs] of CASES) {
    const tool = factory();
    it(`${tool.name} returns isError: true with one text item on failure`, async () => {
      const outputPath = path.join(tmpDir, `${tool.name}-should-not-exist`);
      endpoint.reset();
      const result = await tool.handler(makeArgs(outputPath));
      assertErrorResult(result, tool.name);
      assert.equal(
        endpoint.requests.length,
        1,
        `${tool.name}: the token exchange must hit the loopback endpoint`,
      );
      assert.equal(
        fs.existsSync(outputPath),
        false,
        `${tool.name}: must not write to outputPath on failure`,
      );
    });
  }
});
