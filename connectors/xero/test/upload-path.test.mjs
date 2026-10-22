/**
 * Local-file read policy for upload_attachment (filePath) and upload_file
 * (src/helpers/resolve-upload-path.ts), plus the upload_attachment wire
 * behaviour for includeOnline and contentType.
 *
 * Only prepare_attachment temp files and files under XERO_UPLOAD_DIR may be
 * read; symlinks, non-regular files and files over the cap are refused. A
 * refused path must fail before authentication or any Xero call.
 *
 * Run via `npm test` (node --test test/*.test.mjs) after `npm run build`.
 */
process.env.XERO_CLIENT_ID = "offline-test-id";
process.env.XERO_CLIENT_SECRET = "offline-test-secret";
process.env.XERO_CLIENT_BEARER_TOKEN = "";
delete process.env.XERO_UPLOAD_DIR;

import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const { resolveUploadPath, readUploadFile, MAX_UPLOAD_BYTES } = await import(
  "../dist/helpers/resolve-upload-path.js"
);
const { clearTempFiles } = await import("../dist/helpers/attachment-temp-files.js");
const { default: prepareAttachmentFactory } = await import(
  "../dist/tools/create/prepare-attachment.tool.js"
);
const { default: uploadAttachmentFactory } = await import(
  "../dist/tools/create/upload-attachment.tool.js"
);
const { default: uploadFileFactory } = await import(
  "../dist/tools/create/upload-file.tool.js"
);
const { xeroClient } = await import("../dist/clients/xero-client.js");

const NOT_ALLOWED = /not an allowed upload source/;

let root; // os.tmpdir()-based (on macOS this is the /var/... form)
let uploadDir;
let outsideDir;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "xero-upload-test-"));
  uploadDir = path.join(root, "allowed");
  outsideDir = path.join(root, "outside");
  fs.mkdirSync(uploadDir);
  fs.mkdirSync(outsideDir);
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
  delete process.env.XERO_UPLOAD_DIR;
  clearTempFiles();
});

async function prepare(bytes, fileName = "doc.pdf") {
  const res = await prepareAttachmentFactory().handler({
    chunk: Buffer.from(bytes).toString("base64"),
    fileName,
  });
  assert.equal(res.isError, undefined, res.content[0].text);
  return res.content[0].text.match(/^File path: (.+)$/m)[1];
}

describe("resolveUploadPath: default policy (no XERO_UPLOAD_DIR)", () => {
  it("refuses an arbitrary existing file", () => {
    const secret = path.join(outsideDir, "id_rsa");
    fs.writeFileSync(secret, "PRIVATE KEY");
    assert.throws(() => resolveUploadPath(secret, {}), NOT_ALLOWED);
  });

  it("refuses system files", () => {
    assert.throws(() => resolveUploadPath("/etc/hosts", {}), NOT_ALLOWED);
  });

  it("refuses a relative path", () => {
    assert.throws(() => resolveUploadPath("etc/hosts", {}), /absolute path/);
  });

  it("refuses a missing file", () => {
    assert.throws(
      () => resolveUploadPath(path.join(outsideDir, "nope"), {}),
      /not found or not accessible/,
    );
  });

  it("accepts a file staged by prepare_attachment and reads its bytes", async () => {
    const p = await prepare("PDFBYTES");
    assert.equal(readUploadFile(p, {}).toString(), "PDFBYTES");
  });

  it("accepts the /private/var (realpath) spelling of a staged temp file", async () => {
    const p = await prepare("X");
    const real = fs.realpathSync(p);
    assert.equal(resolveUploadPath(real, {}), real);
  });

  it("refuses a staged temp file that was swapped for a symlink", async () => {
    const p = await prepare("X");
    const target = path.join(outsideDir, "target.txt");
    fs.writeFileSync(target, "SECRET");
    fs.rmSync(p);
    fs.symlinkSync(target, p);
    try {
      assert.throws(() => readUploadFile(p, {}), NOT_ALLOWED);
    } finally {
      fs.rmSync(p, { force: true });
    }
  });

  it("refuses a ../ path that only lexically starts at a staged temp file", async () => {
    const p = await prepare("X");
    const sneaky = path.join(p, "..", "..", "..", "etc", "hosts");
    assert.throws(() => resolveUploadPath(sneaky, {}), /not an allowed|not found/);
  });
});

describe("resolveUploadPath: XERO_UPLOAD_DIR", () => {
  it("accepts a file inside the upload dir", () => {
    const f = path.join(uploadDir, "invoice.pdf");
    fs.writeFileSync(f, "INVOICE");
    assert.equal(
      readUploadFile(f, { XERO_UPLOAD_DIR: uploadDir }).toString(),
      "INVOICE",
    );
  });

  it("accepts mixed /var and /private/var spellings (macOS)", () => {
    const f = path.join(uploadDir, "mixed.pdf");
    fs.writeFileSync(f, "M");
    const realDir = fs.realpathSync(uploadDir);
    // dir configured via realpath, file given via the tmpdir spelling, and
    // vice versa: both must resolve to the same canonical location.
    assert.ok(resolveUploadPath(f, { XERO_UPLOAD_DIR: realDir }));
    assert.ok(
      resolveUploadPath(path.join(realDir, "mixed.pdf"), { XERO_UPLOAD_DIR: uploadDir }),
    );
  });

  it("refuses a file outside the upload dir", () => {
    const f = path.join(outsideDir, "secret.txt");
    fs.writeFileSync(f, "S");
    assert.throws(() => resolveUploadPath(f, { XERO_UPLOAD_DIR: uploadDir }), NOT_ALLOWED);
  });

  it("refuses ../ traversal out of the upload dir", () => {
    const f = path.join(outsideDir, "secret2.txt");
    fs.writeFileSync(f, "S");
    const traversal = path.join(uploadDir, "..", "outside", "secret2.txt");
    assert.throws(
      () => resolveUploadPath(traversal, { XERO_UPLOAD_DIR: uploadDir }),
      NOT_ALLOWED,
    );
  });

  it("refuses a sibling dir that shares the upload dir's name prefix", () => {
    const sibling = `${uploadDir}-evil`;
    fs.mkdirSync(sibling, { recursive: true });
    const f = path.join(sibling, "x.pdf");
    fs.writeFileSync(f, "S");
    assert.throws(() => resolveUploadPath(f, { XERO_UPLOAD_DIR: uploadDir }), NOT_ALLOWED);
  });

  it("refuses a symlink inside the upload dir that points outside it", () => {
    const target = path.join(outsideDir, "escape.txt");
    fs.writeFileSync(target, "SECRET");
    const link = path.join(uploadDir, "escape-link.pdf");
    fs.symlinkSync(target, link);
    assert.throws(() => readUploadFile(link, { XERO_UPLOAD_DIR: uploadDir }), NOT_ALLOWED);
  });

  it("refuses the upload dir itself and a subdirectory (not regular files)", () => {
    const sub = path.join(uploadDir, "sub");
    fs.mkdirSync(sub, { recursive: true });
    assert.throws(() => readUploadFile(uploadDir, { XERO_UPLOAD_DIR: uploadDir }), NOT_ALLOWED);
    assert.throws(
      () => readUploadFile(sub, { XERO_UPLOAD_DIR: uploadDir }),
      /not a regular file/,
    );
  });

  it("refuses a FIFO without blocking", (t) => {
    const fifo = path.join(uploadDir, "pipe.pdf");
    try {
      execFileSync("mkfifo", [fifo]);
    } catch {
      t.skip("mkfifo unavailable");
      return;
    }
    assert.throws(
      () => readUploadFile(fifo, { XERO_UPLOAD_DIR: uploadDir }),
      /not a regular file/,
    );
  });

  it(`refuses a file over the ${MAX_UPLOAD_BYTES}-byte cap`, () => {
    const big = path.join(uploadDir, "big.pdf");
    fs.writeFileSync(big, "");
    fs.truncateSync(big, MAX_UPLOAD_BYTES + 1); // sparse
    assert.throws(
      () => readUploadFile(big, { XERO_UPLOAD_DIR: uploadDir }),
      /exceeds the \d+-byte upload limit/,
    );
  });

  it("accepts a file of exactly the cap", () => {
    const edge = path.join(uploadDir, "edge.pdf");
    fs.writeFileSync(edge, "");
    fs.truncateSync(edge, MAX_UPLOAD_BYTES);
    assert.equal(readUploadFile(edge, { XERO_UPLOAD_DIR: uploadDir }).length, MAX_UPLOAD_BYTES);
  });

  it("rejects a relative or missing XERO_UPLOAD_DIR", () => {
    const f = path.join(uploadDir, "y.pdf");
    fs.writeFileSync(f, "Y");
    assert.throws(
      () => resolveUploadPath(f, { XERO_UPLOAD_DIR: "relative/dir" }),
      /must be an absolute path/,
    );
    assert.throws(
      () => resolveUploadPath(f, { XERO_UPLOAD_DIR: path.join(root, "missing") }),
      /does not point to an existing directory/,
    );
  });
});

describe("upload tools refuse disallowed paths before authenticating", () => {
  let authCalls;
  let originalAuth;

  beforeEach(() => {
    authCalls = 0;
    originalAuth = xeroClient.authenticate;
    xeroClient.authenticate = async () => {
      authCalls++;
    };
  });

  afterEach(() => {
    xeroClient.authenticate = originalAuth;
  });

  it("upload_file: /etc/hosts -> isError, no auth", async () => {
    const res = await uploadFileFactory().handler({
      filePath: "/etc/hosts",
      fileName: "hosts.txt",
      mimeType: "text/plain",
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, NOT_ALLOWED);
    assert.equal(authCalls, 0);
  });

  it("upload_attachment: filePath outside the allow-list -> isError, no auth", async () => {
    const f = path.join(outsideDir, "k.pem");
    fs.writeFileSync(f, "KEY");
    const res = await uploadAttachmentFactory().handler({
      entityType: "invoices",
      entityId: "00000000-0000-0000-0000-000000000000",
      fileName: "k.pdf",
      contentType: "application/pdf",
      filePath: f,
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, NOT_ALLOWED);
    assert.equal(authCalls, 0);
  });

  it("upload_attachment: includeOnline on a non-invoice entity -> isError", async () => {
    const res = await uploadAttachmentFactory().handler({
      entityType: "contacts",
      entityId: "00000000-0000-0000-0000-000000000000",
      fileName: "x.pdf",
      contentType: "application/pdf",
      fileContent: Buffer.from("x").toString("base64"),
      includeOnline: true,
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /includeOnline is only supported/);
    assert.equal(authCalls, 0);
  });
});

describe("upload_attachment wire request (loopback Xero stand-in)", () => {
  let server;
  let requests;
  let saved;

  before(async () => {
    server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        requests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks),
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            Attachments: [
              { AttachmentID: "a-1", FileName: "x.pdf", MimeType: "application/pdf" },
            ],
          }),
        );
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    saved = {
      authenticate: xeroClient.authenticate,
      basePath: xeroClient.accountingApi.basePath,
      tenantId: xeroClient.tenantId,
    };
    xeroClient.authenticate = async () => {};
    xeroClient.tenantId = "tenant-1";
    xeroClient.setTokenSet({ access_token: "offline-token", token_type: "Bearer" });
    xeroClient.accountingApi.basePath = `http://127.0.0.1:${server.address().port}/api.xro/2.0`;
  });

  beforeEach(() => {
    requests = [];
  });

  after(() => {
    xeroClient.authenticate = saved.authenticate;
    xeroClient.accountingApi.basePath = saved.basePath;
    xeroClient.tenantId = saved.tenantId;
    server.close();
  });

  async function upload(args) {
    return uploadAttachmentFactory().handler({
      entityId: "11111111-2222-3333-4444-555555555555",
      fileName: "x.pdf",
      fileContent: Buffer.from("%PDF-1.4 test").toString("base64"),
      ...args,
    });
  }

  it("credit notes: IncludeOnline defaults to false (was hard-coded true)", async () => {
    const res = await upload({ entityType: "creditNotes", contentType: "application/pdf" });
    assert.equal(res.isError, undefined, res.content?.[0]?.text);
    assert.equal(requests.length, 1);
    const q = new URL(requests[0].url, "http://x").searchParams;
    assert.equal(q.get("IncludeOnline"), "false");
  });

  it("invoices: IncludeOnline=true only when explicitly requested", async () => {
    await upload({ entityType: "invoices", contentType: "application/pdf", includeOnline: true });
    const q = new URL(requests[0].url, "http://x").searchParams;
    assert.equal(q.get("IncludeOnline"), "true");
  });

  it("sends the caller's contentType and the exact bytes", async () => {
    await upload({ entityType: "contacts", contentType: "image/png" });
    assert.equal(requests[0].method, "PUT");
    assert.equal(requests[0].headers["content-type"], "image/png");
    assert.equal(requests[0].body.toString(), "%PDF-1.4 test");
  });

  it("rejects a contentType that is not a MIME type at the schema", async () => {
    const { z } = await import("zod");
    const schema = z.object(uploadAttachmentFactory().schema);
    const base = {
      entityType: "invoices",
      entityId: "e",
      fileName: "x.pdf",
      fileContent: "eA==",
    };
    assert.equal(schema.safeParse({ ...base, contentType: "application/pdf" }).success, true);
    assert.equal(
      schema.safeParse({ ...base, contentType: "text/plain\r\nX-Evil: 1" }).success,
      false,
    );
  });
});
