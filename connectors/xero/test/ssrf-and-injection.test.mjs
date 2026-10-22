/**
 * Security regression tests for two input-handling risks:
 *
 *  1. SSRF in upload_attachment's fileUrl — the server fetches a
 *     caller-supplied URL and uploads the bytes to Xero. We lock in the
 *     SSRF guard (src/helpers/safe-fetch-url.ts): only http/https, every
 *     resolved address must be public unicast (private/loopback/link-local/
 *     ULA/cloud-metadata are rejected, including IPv6-embedded IPv4 in hex
 *     form). Redirects, size caps and DNS pinning are in safe-fetch.test.mjs.
 *     Also asserts the upload_attachment
 *     "no source provided" guard returns isError: true.
 *
 *  2. Filter injection in list_payments — invoiceId/paymentId are
 *     interpolated into a guid("...") where-clause. We lock in the UUID
 *     validation at both the tool schema and the handler.
 *
 * Pure-logic and schema layers need no network; the live-fetch cases use a
 * loopback HTTP server purely to prove the guard rejects it before any byte
 * is read.
 *
 * Run via `npm test` (node --test test/*.test.mjs) after `npm run build`.
 */
process.env.XERO_CLIENT_ID = "offline-test-id";
process.env.XERO_CLIENT_SECRET = "offline-test-secret";
process.env.XERO_CLIENT_BEARER_TOKEN = "";

import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { z } from "zod";

const { isBlockedAddress, assertSafeUrl, safeFetchUrl } =
  await import("../dist/helpers/safe-fetch-url.js");

const { default: listPaymentsFactory } = await import(
  "../dist/tools/list/list-payments.tool.js"
);
const { default: uploadAttachmentFactory } = await import(
  "../dist/tools/create/upload-attachment.tool.js"
);
const { default: createInvoiceFactory } = await import(
  "../dist/tools/create/create-invoice.tool.js"
);
const { default: listAttachmentsFactory } = await import(
  "../dist/tools/list/list-attachments.tool.js"
);
const { default: downloadAttachmentFactory } = await import(
  "../dist/tools/download/download-attachment.tool.js"
);
const { listXeroPayments } = await import(
  "../dist/handlers/list-xero-payments.handler.js"
);
const { getFxRate } = await import("../dist/handlers/get-fx-rate.handler.js");

describe("isBlockedAddress: private/loopback/link-local are blocked", () => {
  const BLOCKED = [
    "127.0.0.1", // loopback
    "0.0.0.0", // unspecified
    "10.0.0.5", // private
    "172.16.0.1", // private
    "172.31.255.255", // private (top of /12)
    "192.168.1.1", // private
    "169.254.169.254", // AWS/GCP metadata (link-local)
    "100.64.0.1", // CGNAT
    "::1", // IPv6 loopback
    "::", // IPv6 unspecified
    "fc00::1", // ULA
    "fd12:3456::1", // ULA
    "fe80::1", // IPv6 link-local
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:169.254.169.254", // IPv4-mapped metadata
    // Hex forms of embedded IPv4 (what the WHATWG URL parser produces):
    "::ffff:7f00:1", // IPv4-mapped 127.0.0.1
    "::ffff:a9fe:a9fe", // IPv4-mapped 169.254.169.254
    "::ffff:a00:5", // IPv4-mapped 10.0.0.5
    "0:0:0:0:0:ffff:7f00:1", // expanded IPv4-mapped loopback
    "::7f00:1", // IPv4-compatible 127.0.0.1
    "::a9fe:a9fe", // IPv4-compatible metadata
    "::ffff:0:7f00:1", // IPv4-translated loopback (RFC 2765)
    "64:ff9b::7f00:1", // NAT64 well-known prefix -> 127.0.0.1
    "64:ff9b::a9fe:a9fe", // NAT64 -> metadata
    "64:ff9b::169.254.169.254", // NAT64, dotted tail
    "64:ff9b:1::808:808", // NAT64 local-use prefix (blocked outright)
    "64:ff9b:0:1::808:808", // elsewhere in 64:ff9b::/32 (blocked outright)
    "2002:7f00:1::1", // 6to4 -> 127.0.0.1
    "2002:a9fe:a9fe::", // 6to4 -> metadata
    "2001:0:4136:e378::1", // Teredo (blocked outright)
    "fec0::1", // deprecated site-local
    "ff02::1", // multicast
    "100::1", // discard-only
    "fe80::1%en0", // link-local with zone id
  ];
  for (const addr of BLOCKED) {
    it(`blocks ${addr}`, () => {
      assert.equal(isBlockedAddress(addr), true);
    });
  }
});

describe("isBlockedAddress: public unicast is allowed", () => {
  const ALLOWED = [
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "2606:2800:220:1::1",
    "::ffff:808:808", // IPv4-mapped public 8.8.8.8
    "::ffff:8.8.8.8",
    "64:ff9b::808:808", // NAT64 to a public IPv4
    "2002:808:808::1", // 6to4 relay to a public IPv4
  ];
  for (const addr of ALLOWED) {
    it(`allows ${addr}`, () => {
      assert.equal(isBlockedAddress(addr), false);
    });
  }
});

describe("assertSafeUrl: scheme and host validation", () => {
  it("rejects non-http(s) schemes", async () => {
    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com/x",
      "gopher://example.com/",
      "data:text/plain,hello",
    ]) {
      await assert.rejects(() => assertSafeUrl(url), /http or https|valid URL/);
    }
  });

  it("rejects a malformed URL", async () => {
    await assert.rejects(() => assertSafeUrl("not a url"), /valid URL/);
  });

  it("rejects an IP-literal pointing at cloud metadata", async () => {
    await assert.rejects(
      () => assertSafeUrl("http://169.254.169.254/latest/meta-data/"),
      /private, loopback, or link-local/,
    );
  });

  it("rejects an IP-literal pointing at loopback", async () => {
    await assert.rejects(
      () => assertSafeUrl("http://127.0.0.1:8080/secret"),
      /private, loopback, or link-local/,
    );
  });

  it("rejects a bracketed IPv6 loopback literal", async () => {
    await assert.rejects(
      () => assertSafeUrl("http://[::1]:9000/"),
      /private, loopback, or link-local/,
    );
  });

  it("rejects a hostname that resolves only to loopback", async () => {
    // localhost resolves to 127.0.0.1 / ::1
    await assert.rejects(
      () => assertSafeUrl("http://localhost/x"),
      /private, loopback, or link-local/,
    );
  });

  for (const host of [
    "[::ffff:127.0.0.1]", // parser rewrites to [::ffff:7f00:1]
    "[::ffff:7f00:1]",
    "[::ffff:a9fe:a9fe]",
    "[0:0:0:0:0:ffff:169.254.169.254]",
    "[::7f00:1]",
    "[64:ff9b::a9fe:a9fe]",
    "[2002:a9fe:a9fe::1]",
  ]) {
    it(`rejects the IPv6-embedded IPv4 literal ${host}`, async () => {
      await assert.rejects(
        () => assertSafeUrl(`http://${host}/latest/meta-data/`),
        /private, loopback, or link-local/,
      );
    });
  }

  it("rejects decimal and hex IPv4 host forms (canonicalised by the parser)", async () => {
    for (const host of ["2130706433", "0x7f000001", "0177.0.0.1", "2852039166"]) {
      await assert.rejects(
        () => assertSafeUrl(`http://${host}/`),
        /private, loopback, or link-local/,
        host,
      );
    }
  });

  it("rejects a hostname when ANY resolved address is internal", async () => {
    const lookup = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "::ffff:a9fe:a9fe", family: 6 },
    ];
    await assert.rejects(
      () => assertSafeUrl("http://mixed.example/", lookup),
      /private, loopback, or link-local/,
    );
  });

  it("accepts a public IP literal", async () => {
    const url = await assertSafeUrl("https://8.8.8.8/file.pdf");
    assert.equal(url.hostname, "8.8.8.8");
  });
});

describe("safeFetchUrl: refuses to fetch from a loopback server", () => {
  let server;
  let port;

  before(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("SECRET-INTERNAL-DATA");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
  });

  after(() => {
    server.close();
  });

  it("never connects to the loopback target", async () => {
    await assert.rejects(
      () => safeFetchUrl(`http://127.0.0.1:${port}/x`),
      /private, loopback, or link-local/,
    );
  });
});

describe("upload_attachment: no-source guard sets isError", () => {
  const tool = uploadAttachmentFactory();

  it("returns isError: true when no file source is provided", async () => {
    const result = await tool.handler({
      entityType: "invoices",
      entityId: "00000000-0000-0000-0000-000000000000",
      fileName: "x.pdf",
      contentType: "application/pdf",
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /At least one of/);
  });

  it("returns isError: true (not a raw throw) for a blocked fileUrl", async () => {
    const result = await tool.handler({
      entityType: "invoices",
      entityId: "00000000-0000-0000-0000-000000000000",
      fileName: "x.pdf",
      contentType: "application/pdf",
      fileUrl: "http://169.254.169.254/latest/meta-data/",
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /private, loopback, or link-local/);
  });
});

describe("list_payments: invoiceId/paymentId must be GUIDs (filter-injection guard)", () => {
  const schema = z.object(listPaymentsFactory().schema);
  const GUID = "11111111-2222-3333-4444-555555555555";

  it("accepts valid GUIDs", () => {
    assert.equal(
      schema.safeParse({ page: 1, invoiceId: GUID, paymentId: GUID }).success,
      true,
    );
  });

  it("rejects an injection payload in invoiceId", () => {
    assert.equal(
      schema.safeParse({
        page: 1,
        invoiceId: '") OR Amount>guid("',
      }).success,
      false,
    );
  });

  it("rejects an injection payload in paymentId", () => {
    assert.equal(
      schema.safeParse({
        page: 1,
        paymentId: 'x") AND Status=="AUTHORISED',
      }).success,
      false,
    );
  });

  it("handler rejects a non-GUID invoiceId that bypasses the schema", async () => {
    // Call the handler directly with an injection payload to prove the
    // defence-in-depth assertGuid in the handler also fires (returns the
    // standard isError result, never a raw guid() injection).
    const res = await listXeroPayments(1, { invoiceId: '") OR 1==1 guid("' });
    assert.equal(res.isError, true);
    assert.match(res.error, /valid Xero GUID/);
  });
});

describe("create_invoice: ACCPAY + invoiceNumber guard sets isError", () => {
  const tool = createInvoiceFactory();

  it("returns isError: true (not success-shaped) on the validation guard", async () => {
    const result = await tool.handler({
      contactId: "c-1",
      type: "ACCPAY",
      invoiceNumber: "INV-1",
      lineItems: [
        {
          description: "x",
          quantity: 1,
          unitAmount: 10,
          accountCode: "200",
          taxType: "NONE",
        },
      ],
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /only supported on ACCREC/);
  });
});

describe("list_attachments / download_attachment entityType parity", () => {
  const ELEVEN = [
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
  ];
  const listSchema = z.object(listAttachmentsFactory().schema);
  const downloadSchema = z.object(downloadAttachmentFactory().schema);

  it("list_attachments now accepts all eleven entity types", () => {
    for (const entityType of ELEVEN) {
      assert.equal(
        listSchema.safeParse({ entityType, entityId: "e-1" }).success,
        true,
        `list_attachments must accept ${entityType}`,
      );
    }
  });

  it("download_attachment still accepts all eleven entity types (parity)", () => {
    for (const entityType of ELEVEN) {
      assert.equal(
        downloadSchema.safeParse({
          entityType,
          entityId: "e-1",
          attachmentId: "a-1",
          outputPath: "/tmp/x.bin",
        }).success,
        true,
        `download_attachment must accept ${entityType}`,
      );
    }
  });
});

describe("get_fx_rate: date/from/to are format-validated (path/query injection guard)", () => {
  it("rejects a path-traversal date before any fetch", async () => {
    const res = await getFxRate({
      from: "GBP",
      to: "USD",
      date: "../../../etc/passwd",
    });
    assert.equal(res.isError, true);
    assert.match(res.error, /Invalid date/);
  });

  it("rejects a date containing an @version pivot", async () => {
    const res = await getFxRate({ from: "GBP", to: "USD", date: "1@evil" });
    assert.equal(res.isError, true);
    assert.match(res.error, /Invalid date/);
  });

  it("rejects a non-ISO source currency", async () => {
    const res = await getFxRate({ from: "GB/x", to: "USD", date: "latest" });
    assert.equal(res.isError, true);
    assert.match(res.error, /Invalid source currency/);
  });

  it("rejects a non-ISO target currency", async () => {
    const res = await getFxRate({ from: "GBP", to: "US?", date: "latest" });
    assert.equal(res.isError, true);
    assert.match(res.error, /Invalid target currency/);
  });
});
