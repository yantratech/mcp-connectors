/**
 * GUID validation for ids interpolated into Xero where-clause guid("...")
 * literals.
 *
 * A guid("...") literal is not a quoted string, so escapeWhereValue cannot
 * make it safe: every id that reaches one must be format-validated. We lock
 * that in at three layers:
 *
 *  - the shared assertGuid helper (src/helpers/assert-guid.ts);
 *  - the tool schemas (zod `.guid()`) for list_payments (invoiceId,
 *    paymentId), list_bank_transactions (bankAccountId) and
 *    list_credit_notes (contactId);
 *  - the exported handlers, which reject a malformed id BEFORE the token
 *    exchange and before anything reaches the wire;
 *
 * plus a source scan of the compiled handlers so a future guid("${...}")
 * interpolation that skips assertGuid fails this test.
 *
 * Fully offline: xeroClient.authenticate and the accountingApi methods are
 * stubbed. Run via `npm test` (node --test test/*.test.mjs) after
 * `npm run build`.
 */
process.env.XERO_CLIENT_ID = "offline-test-id";
process.env.XERO_CLIENT_SECRET = "offline-test-secret";
process.env.XERO_CLIENT_BEARER_TOKEN = "";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Dynamic imports so the env assignments above run first.
const { assertGuid, GUID_RE } = await import("../dist/helpers/assert-guid.js");
const { default: listPaymentsFactory } = await import(
  "../dist/tools/list/list-payments.tool.js"
);
const { default: listBankTransactionsFactory } = await import(
  "../dist/tools/list/list-bank-transactions.tool.js"
);
const { default: listCreditNotesFactory } = await import(
  "../dist/tools/list/list-credit-notes.tool.js"
);
const { listXeroPayments } = await import(
  "../dist/handlers/list-xero-payments.handler.js"
);
const { listXeroBankTransactions } = await import(
  "../dist/handlers/list-xero-bank-transactions.handler.js"
);
const { listXeroCreditNotes } = await import(
  "../dist/handlers/list-xero-credit-notes.handler.js"
);
const { xeroClient } = await import("../dist/clients/xero-client.js");

const GUID = "e0a1b2c3-0000-4000-8000-000000000004";
const INJECTIONS = [
  '") OR 1==1 OR guid("',
  'x") AND Status=="AUTHORISED',
  `${GUID}") OR Contact.Name!=guid("`,
  "",
  "not-a-guid",
  ` ${GUID}`,
  `${GUID}\n`,
  GUID.slice(0, -1), // one hex short
  `g${GUID.slice(1)}`, // non-hex
];

// --- offline stubbing of the singleton Xero client -----------------------

const originals = {
  authenticate: xeroClient.authenticate,
  tenantId: xeroClient.tenantId,
  getPayments: xeroClient.accountingApi.getPayments,
  getBankTransactions: xeroClient.accountingApi.getBankTransactions,
  getCreditNotes: xeroClient.accountingApi.getCreditNotes,
};

let authCalls;
let wireCalls;

beforeEach(() => {
  authCalls = 0;
  wireCalls = [];
  xeroClient.authenticate = async () => {
    authCalls += 1;
  };
  xeroClient.tenantId = "tenant-offline-test";
  const record = (name) => async (_tenant, _since, where) => {
    wireCalls.push({ name, where });
    return { body: { pagination: { itemCount: 0, pageCount: 0 } } };
  };
  xeroClient.accountingApi.getPayments = record("getPayments");
  xeroClient.accountingApi.getBankTransactions = record("getBankTransactions");
  xeroClient.accountingApi.getCreditNotes = record("getCreditNotes");
});

afterEach(() => {
  xeroClient.authenticate = originals.authenticate;
  xeroClient.tenantId = originals.tenantId;
  xeroClient.accountingApi.getPayments = originals.getPayments;
  xeroClient.accountingApi.getBankTransactions = originals.getBankTransactions;
  xeroClient.accountingApi.getCreditNotes = originals.getCreditNotes;
});

// --- helper ---------------------------------------------------------------

describe("assertGuid helper", () => {
  it("returns a well-formed GUID unchanged (either case)", () => {
    assert.equal(assertGuid(GUID, "id"), GUID);
    assert.equal(assertGuid(GUID.toUpperCase(), "id"), GUID.toUpperCase());
  });

  it("accepts the nil GUID (Xero ids are not strict RFC 4122)", () => {
    const nil = "00000000-0000-0000-0000-000000000000";
    assert.equal(assertGuid(nil, "id"), nil);
  });

  for (const bad of INJECTIONS) {
    it(`rejects ${JSON.stringify(bad)} naming the field`, () => {
      assert.throws(() => assertGuid(bad, "contactId"), {
        message: "contactId must be a valid Xero GUID",
      });
    });
  }

  it("GUID_RE agrees with zod .guid() on every case", () => {
    const zodGuid = z.string().guid();
    for (const value of [GUID, ...INJECTIONS]) {
      assert.equal(
        GUID_RE.test(value),
        zodGuid.safeParse(value).success,
        `mismatch for ${JSON.stringify(value)}`,
      );
    }
  });
});

// --- schemas ----------------------------------------------------------------

const SCHEMA_CASES = [
  ["list_payments", listPaymentsFactory, "invoiceId"],
  ["list_payments", listPaymentsFactory, "paymentId"],
  ["list_bank_transactions", listBankTransactionsFactory, "bankAccountId"],
  ["list_credit_notes", listCreditNotesFactory, "contactId"],
];

describe("tool schemas: GUID params interpolated into guid(...) are .guid()-validated", () => {
  for (const [toolName, factory, field] of SCHEMA_CASES) {
    const schema = z.object(factory().schema);

    it(`${toolName}.${field} accepts a valid GUID`, () => {
      assert.equal(schema.safeParse({ [field]: GUID }).success, true);
    });

    it(`${toolName}.${field} stays optional`, () => {
      assert.equal(schema.safeParse({}).success, true);
    });

    it(`${toolName}.${field} rejects injection payloads and malformed ids`, () => {
      for (const bad of INJECTIONS) {
        const parsed = schema.safeParse({ [field]: bad });
        assert.equal(
          parsed.success,
          false,
          `${toolName}.${field} must reject ${JSON.stringify(bad)}`,
        );
        assert.match(
          parsed.error.issues[0].message,
          new RegExp(`${field} must be a valid Xero GUID`),
        );
      }
    });
  }
});

// --- handlers (defence in depth, schema bypassed) ------------------------

describe("handlers reject a malformed GUID before authenticating or calling Xero", () => {
  const PAYLOAD = '") OR 1==1 OR guid("';

  it("listXeroBankTransactions(bankAccountId)", async () => {
    const res = await listXeroBankTransactions(1, PAYLOAD);
    assert.equal(res.isError, true);
    assert.match(res.error, /bankAccountId must be a valid Xero GUID/);
    assert.equal(authCalls, 0, "no token exchange for an invalid id");
    assert.equal(wireCalls.length, 0);
  });

  it("listXeroCreditNotes(contactId)", async () => {
    const res = await listXeroCreditNotes(1, PAYLOAD);
    assert.equal(res.isError, true);
    assert.match(res.error, /contactId must be a valid Xero GUID/);
    assert.equal(authCalls, 0, "no token exchange for an invalid id");
    assert.equal(wireCalls.length, 0);
  });

  it("listXeroPayments(invoiceId / paymentId)", async () => {
    for (const field of ["invoiceId", "paymentId"]) {
      const res = await listXeroPayments(1, { [field]: PAYLOAD });
      assert.equal(res.isError, true);
      assert.match(res.error, new RegExp(`${field} must be a valid Xero GUID`));
    }
    assert.equal(authCalls, 0, "no token exchange for an invalid id");
    assert.equal(wireCalls.length, 0);
  });

  it("a valid GUID still reaches the wire inside a guid(...) literal", async () => {
    await listXeroBankTransactions(1, GUID);
    await listXeroCreditNotes(1, GUID, ["PAID"]);
    await listXeroPayments(1, { invoiceId: GUID, paymentId: GUID });

    assert.equal(
      wireCalls.find((c) => c.name === "getBankTransactions").where,
      `BankAccount.AccountID=guid("${GUID}") AND Status!="DELETED"`,
    );
    assert.equal(
      wireCalls.find((c) => c.name === "getCreditNotes").where,
      `Contact.ContactID=guid("${GUID}") AND Status=="PAID"`,
    );
    assert.equal(
      wireCalls.find((c) => c.name === "getPayments").where,
      `Invoice.InvoiceID==guid("${GUID}") AND PaymentID==guid("${GUID}")`,
    );
  });
});

// --- regression guard over the compiled handlers -------------------------

describe("every guid(\"${...}\") interpolation in a handler goes through assertGuid", () => {
  const handlersDir = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "dist",
    "handlers",
  );

  it("finds no unguarded interpolation", () => {
    const offenders = [];
    let guarded = 0;
    for (const file of readdirSync(handlersDir)) {
      if (!file.endsWith(".js")) continue;
      const src = readFileSync(join(handlersDir, file), "utf8");
      // Every guid(" opening in emitted code — template literal, string
      // concatenation or otherwise — must be immediately followed by an
      // assertGuid(...) interpolation. Comment lines are skipped.
      const code = src
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
        .join("\n");
      for (const match of code.matchAll(/guid\("(.{0,40})/g)) {
        if (match[1].startsWith("${assertGuid(")) {
          guarded += 1;
        } else {
          offenders.push(`${file}: guid("${match[1]}`);
        }
      }
    }
    assert.deepEqual(offenders, []);
    // Sanity: the scan actually found the four known call sites.
    assert.ok(guarded >= 4, `expected >= 4 guarded sites, found ${guarded}`);
  });
});
