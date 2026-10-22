/**
 * Offline tests for the credit-note, payment and contact read tools:
 *
 *  - list_credit_notes: DELETED/VOIDED excluded by default with a labelled
 *    excluded-count header, a `statuses` override param, 'page N of M;
 *    T total matching' pagination headers, and the HTTP-200-empty caveat
 *    on filtered empty results;
 *  - get_payment: rendered via list_payments' formatPayment, so amounts
 *    are currency-labelled, cross-currency payments show Bank Amount and
 *    Currency Rate, and no literal "undefined" appears for a code-less
 *    account;
 *  - get_contact: renders the Balances block (AR/AP Outstanding and
 *    Overdue, organisation base currency) instead of silently dropping it.
 *
 * The handler-level tests stub xeroClient.accountingApi methods to capture
 * the outgoing wire request (where clause, order, page, pageSize) and feed
 * back canned pages — no network, no live API.
 *
 * Run via `npm test` (node --test test/*.test.mjs) after `npm run build`.
 */
process.env.XERO_CLIENT_ID = "offline-test-id";
process.env.XERO_CLIENT_SECRET = "offline-test-secret";
process.env.XERO_CLIENT_BEARER_TOKEN = "";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

// Dynamic imports so the env assignments above run first (static imports
// are hoisted ahead of them).
const creditNotesModule = await import(
  "../dist/tools/list/list-credit-notes.tool.js"
);
const { listXeroCreditNotes, DEFAULT_CREDIT_NOTE_STATUSES } = await import(
  "../dist/handlers/list-xero-credit-notes.handler.js"
);
const getPaymentModule = await import("../dist/tools/get/get-payment.tool.js");
const getContactModule = await import("../dist/tools/get/get-contact.tool.js");
const { xeroClient } = await import("../dist/clients/xero-client.js");

const schemaOf = (factory) => z.object(factory().schema);

const DEFAULT_WHERE =
  '(Status=="DRAFT" OR Status=="SUBMITTED" OR Status=="AUTHORISED" OR Status=="PAID")';
const CONTACT_GUID = "e0a1b2c3-0000-4000-8000-000000000004";

// --- offline stubbing of the singleton Xero client -----------------------

const originals = {
  authenticate: xeroClient.authenticate,
  tenantId: xeroClient.tenantId,
  getCreditNotes: xeroClient.accountingApi.getCreditNotes,
  getPayment: xeroClient.accountingApi.getPayment,
  getContact: xeroClient.accountingApi.getContact,
};

beforeEach(() => {
  xeroClient.authenticate = async () => {};
  xeroClient.tenantId = "tenant-offline-test";
});

afterEach(() => {
  xeroClient.authenticate = originals.authenticate;
  xeroClient.tenantId = originals.tenantId;
  xeroClient.accountingApi.getCreditNotes = originals.getCreditNotes;
  xeroClient.accountingApi.getPayment = originals.getPayment;
  xeroClient.accountingApi.getContact = originals.getContact;
});

/**
 * Stubs accountingApi.getCreditNotes, recording each outgoing wire request
 * and answering: probe calls (pageSize 1) get only pagination itemCounts;
 * the main call gets the supplied page body. Pass `pagination: null` to
 * simulate Xero omitting the pagination block entirely.
 */
function stubCreditNotes({
  creditNotes = [],
  pagination = { page: 1, pageSize: 10, pageCount: 1, itemCount: creditNotes.length },
  deletedCount = 0,
  voidedCount = 0,
} = {}) {
  const calls = [];
  xeroClient.accountingApi.getCreditNotes = async (
    tenantId,
    ifModifiedSince,
    where,
    order,
    page,
    unitdp,
    pageSize,
  ) => {
    calls.push({ tenantId, where, order, page, pageSize });
    if (pageSize === 1 && where?.includes('Status=="DELETED"')) {
      return { body: { creditNotes: [], pagination: { itemCount: deletedCount } } };
    }
    if (pageSize === 1 && where?.includes('Status=="VOIDED"')) {
      return { body: { creditNotes: [], pagination: { itemCount: voidedCount } } };
    }
    return { body: { creditNotes, pagination: pagination ?? undefined } };
  };
  return calls;
}

const paidNote = (n) => ({
  creditNoteID: `cn-${n}`,
  creditNoteNumber: `CN-${1000 + n}`,
  type: "ACCPAYCREDIT",
  status: "PAID",
  total: 100 + n,
  currencyCode: "GBP",
});

// --- default DELETED/VOIDED exclusion on the wire ------------------------

describe("listXeroCreditNotes handler (default status filter on the wire)", () => {
  it("sends the default status filter and both excluded-count probes", async () => {
    const calls = stubCreditNotes({
      creditNotes: [paidNote(1), paidNote(2)],
      pagination: { page: 1, pageSize: 10, pageCount: 2, itemCount: 13 },
      deletedCount: 6,
      voidedCount: 0,
    });

    const response = await listXeroCreditNotes(1);
    assert.equal(response.error, null);

    assert.equal(calls.length, 3);
    assert.equal(calls[0].where, DEFAULT_WHERE);
    assert.equal(calls[0].order, "UpdatedDateUTC DESC");
    assert.equal(calls[0].page, 1);
    assert.equal(calls[0].pageSize, 10);
    // Regression guard: without a status filter, DELETED rows come back too.
    // The default wire request must filter.
    assert.doesNotMatch(calls[0].where, /DELETED|VOIDED/);
    assert.equal(calls[1].where, 'Status=="DELETED"');
    assert.equal(calls[1].pageSize, 1);
    assert.equal(calls[2].where, 'Status=="VOIDED"');
    assert.equal(calls[2].pageSize, 1);

    const result = response.result;
    assert.equal(result.defaultStatusFilterApplied, true);
    assert.equal(result.excludedDeleted, 6);
    assert.equal(result.excludedVoided, 0);
    assert.equal(result.pagination.itemCount, 13);
  });

  it("keeps DELETED and VOIDED out of the default status set", () => {
    assert.deepEqual(DEFAULT_CREDIT_NOTE_STATUSES, [
      "DRAFT",
      "SUBMITTED",
      "AUTHORISED",
      "PAID",
    ]);
  });

  it("honours an explicit statuses filter without probing", async () => {
    const calls = stubCreditNotes();
    const response = await listXeroCreditNotes(1, undefined, ["DELETED"]);

    assert.equal(response.error, null);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].where, 'Status=="DELETED"');
    assert.equal(response.result.defaultStatusFilterApplied, false);
    assert.equal(response.result.excludedDeleted, undefined);
  });

  it("combines the contact filter with the status filter", async () => {
    const calls = stubCreditNotes();
    await listXeroCreditNotes(1, CONTACT_GUID, ["VOIDED", "DELETED"]);

    assert.equal(
      calls[0].where,
      `Contact.ContactID=guid("${CONTACT_GUID}") AND (Status=="VOIDED" OR Status=="DELETED")`,
    );
  });

  it("skips the count probes beyond page 1", async () => {
    const calls = stubCreditNotes();
    await listXeroCreditNotes(2);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].page, 2);
  });

  it("rejects a malformed contactId before anything reaches the wire", async () => {
    const calls = stubCreditNotes();
    const response = await listXeroCreditNotes(1, 'x") OR Status=="DELETED');

    assert.equal(response.isError, true);
    assert.match(response.error, /valid Xero GUID/);
    assert.equal(calls.length, 0);
  });
});

// --- rendered headers ---------------------------------------------------

describe("list_credit_notes tool output (exclusion + pagination headers)", () => {
  const tool = creditNotesModule.default();

  it("reports 'page N of M; T total matching' and the excluded counts", async () => {
    stubCreditNotes({
      creditNotes: [paidNote(1), paidNote(2)],
      pagination: { page: 1, pageSize: 10, pageCount: 2, itemCount: 13 },
      deletedCount: 6,
      voidedCount: 0,
    });

    const result = await tool.handler({ page: 1 });
    const header = result.content[0].text;

    assert.match(
      header,
      /Found 2 credit notes \(page 1 of 2; 13 total matching\)\./,
    );
    assert.match(
      header,
      /Excluded by default: 6 DELETED and 0 VOIDED credit notes — pass statuses \(e\.g\. \['DELETED'\] or \['VOIDED'\]\) to view them\./,
    );
    // Regression guard: a bare page-size count with no pagination metadata.
    assert.doesNotMatch(header, /^Found \d+ credit notes:$/);
    assert.equal(result.content.length, 3);
    assert.match(result.content[1].text, /Status: PAID/);
  });

  it("drops the exclusion line when statuses are explicit", async () => {
    stubCreditNotes({
      creditNotes: [{ ...paidNote(1), status: "DELETED" }],
      pagination: { page: 1, pageSize: 10, pageCount: 1, itemCount: 6 },
    });

    const result = await tool.handler({ page: 1, statuses: ["DELETED"] });
    const header = result.content[0].text;

    assert.match(header, /Found 1 credit notes \(page 1 of 1; 6 total matching\)\./);
    assert.doesNotMatch(header, /Excluded by default/);
    assert.match(result.content[1].text, /Status: DELETED/);
  });

  it("falls back to a more-pages-may-exist header when Xero omits pagination", async () => {
    stubCreditNotes({
      creditNotes: [paidNote(1)],
      pagination: null,
    });

    const result = await tool.handler({ page: 1 });
    assert.match(
      result.content[0].text,
      /Found 1 credit notes \(page 1; 10 per page — if 10 were returned, more pages may exist\)\./,
    );
  });

  it("flags that a filtered empty page does not confirm the contact exists", async () => {
    stubCreditNotes({ creditNotes: [] });

    const result = await tool.handler({ page: 1, contactId: CONTACT_GUID });
    const header = result.content[0].text;

    assert.match(header, /empty page \(HTTP 200\)/);
    assert.match(header, /does NOT confirm the contact exists/);
    assert.match(header, /get_contact/);
  });

  it("keeps unfiltered empty pages free of the contact caveat", async () => {
    stubCreditNotes({ creditNotes: [] });

    const result = await tool.handler({ page: 1 });
    assert.doesNotMatch(result.content[0].text, /does NOT confirm/);
  });
});

describe("list_credit_notes schema and description", () => {
  const tool = creditNotesModule.default();

  it("accepts the statuses enum incl. DELETED/VOIDED and defaults page to 1", () => {
    const s = schemaOf(creditNotesModule.default);
    assert.equal(s.parse({}).page, 1);
    assert.equal(s.safeParse({ statuses: ["DELETED", "VOIDED"] }).success, true);
    assert.equal(s.safeParse({ statuses: ["BOGUS"] }).success, false);
  });

  it("describes the default exclusion and the pagination header", () => {
    assert.match(tool.description, /DELETED and VOIDED credit notes are EXCLUDED/);
    assert.match(tool.description, /page N of M; T total/);
  });
});

// --- get_payment currency labelling --------------------------------------

describe("get_payment output (currency labels, no literal 'undefined')", () => {
  const tool = getPaymentModule.default();

  it("labels the invoice currency and shows the cross-currency bank amount", async () => {
    xeroClient.accountingApi.getPayment = async () => ({
      body: {
        payments: [
          {
            paymentID: "e0a1b2c3-0000-4000-8000-000000000003",
            date: "2026-01-15",
            amount: 100,
            bankAmount: 80,
            currencyRate: 1.25,
            status: "AUTHORISED",
            paymentType: "ACCPAYPAYMENT",
            account: { name: "GBP Current Account", accountID: "acc-1" },
            invoice: {
              invoiceID: "e0a1b2c3-0000-4000-8000-000000000002",
              invoiceNumber: "INV-1",
              currencyCode: "USD",
            },
          },
        ],
      },
    });

    const result = await tool.handler({
      paymentId: "e0a1b2c3-0000-4000-8000-000000000003",
    });
    const text = result.content[0].text;

    assert.match(text, /^Payment details:/);
    assert.match(text, /Amount: 100 USD/);
    assert.match(text, /Bank Amount: 80 \(in the bank account's own currency\)/);
    assert.match(text, /Currency Rate: 1\.25/);
    // Regression guard: no bare "Amount: 100", and no "Account: GBP Current
    // Account (undefined)" for the code-less account.
    assert.doesNotMatch(text, /Amount: 100\n/);
    assert.doesNotMatch(text, /undefined/);
    assert.match(text, /Account: GBP Current Account \(acc-1\)/);
  });

  it("never prints 'undefined' when the account has no id at all", async () => {
    xeroClient.accountingApi.getPayment = async () => ({
      body: {
        payments: [
          {
            paymentID: "e0a1b2c3-0000-4000-8000-000000000001",
            amount: 2500.5,
            status: "DELETED",
            account: { name: "USD Current Account" },
            invoice: { invoiceID: "inv-2", currencyCode: "USD" },
          },
        ],
      },
    });

    const result = await tool.handler({
      paymentId: "e0a1b2c3-0000-4000-8000-000000000001",
    });
    const text = result.content[0].text;

    assert.match(text, /Amount: 2500\.5 USD/);
    assert.match(text, /Status: DELETED/);
    assert.doesNotMatch(text, /undefined/);
  });

  it("renders code-only account stubs instead of dropping the account line", async () => {
    xeroClient.accountingApi.getPayment = async () => ({
      body: {
        payments: [
          {
            paymentID: "9b2f8c1e-0000-4000-8000-000000000003",
            amount: 10,
            // Xero's documented Payments sample: Account with only
            // AccountID + Code, no Name.
            account: { code: "090", accountID: "acc-9" },
            invoice: { invoiceID: "inv-3", currencyCode: "GBP" },
          },
        ],
      },
    });

    const result = await tool.handler({
      paymentId: "9b2f8c1e-0000-4000-8000-000000000003",
    });
    const text = result.content[0].text;

    assert.match(text, /Account: account code 090 \(acc-9\)/);
    assert.doesNotMatch(text, /undefined/);
  });

  it("shows the account code beside a named account", async () => {
    xeroClient.accountingApi.getPayment = async () => ({
      body: {
        payments: [
          {
            paymentID: "9b2f8c1e-0000-4000-8000-000000000004",
            amount: 10,
            account: { name: "GBP Current Account", code: "090", accountID: "acc-1" },
            invoice: { invoiceID: "inv-4", currencyCode: "GBP" },
          },
        ],
      },
    });

    const result = await tool.handler({
      paymentId: "9b2f8c1e-0000-4000-8000-000000000004",
    });
    assert.match(
      result.content[0].text,
      /Account: GBP Current Account \[code 090\] \(acc-1\)/,
    );
  });

  it("describes the invoice-currency and bank-amount semantics", () => {
    assert.match(tool.description, /invoice's currency/);
    assert.match(tool.description, /Bank Amount/);
  });
});

// --- get_contact balances ------------------------------------------------

describe("formatContactDetails (Balances block rendered, not dropped)", () => {
  const { formatContactDetails } = getContactModule;

  it("renders AR/AP outstanding and overdue balances with the base-currency label", () => {
    const text = formatContactDetails({
      contactID: CONTACT_GUID,
      name: "Example Holdings Ltd",
      contactStatus: "ACTIVE",
      isSupplier: false,
      isCustomer: true,
      balances: {
        accountsReceivable: { outstanding: 1234.56, overdue: 1234.56 },
        accountsPayable: { outstanding: 0, overdue: 0 },
      },
    });

    assert.match(
      text,
      /Balances \(organisation base currency — see list_organisation_details\):/,
    );
    assert.match(text, /AR Outstanding: 1234\.56 \(Overdue: 1234\.56\)/);
    // Zeros are a definite answer, not missing data.
    assert.match(text, /AP Outstanding: 0 \(Overdue: 0\)/);
    assert.doesNotMatch(text, /undefined/);
  });

  it("omits the Balances block cleanly when Xero sends none", () => {
    const text = formatContactDetails({
      contactID: "c-1",
      name: "Fresh Contact Ltd",
      contactStatus: "ACTIVE",
    });

    assert.doesNotMatch(text, /Balances/);
    assert.doesNotMatch(text, /undefined/);
  });

  it("is what the tool handler renders", async () => {
    xeroClient.accountingApi.getContact = async () => ({
      body: {
        contacts: [
          {
            contactID: CONTACT_GUID,
            name: "Example Holdings Ltd",
            balances: {
              accountsReceivable: { outstanding: 1234.56, overdue: 1234.56 },
            },
          },
        ],
      },
    });

    const tool = getContactModule.default();
    const result = await tool.handler({ contactId: CONTACT_GUID });
    const text = result.content[0].text;

    assert.match(text, /^Contact details:/);
    assert.match(text, /AR Outstanding: 1234\.56 \(Overdue: 1234\.56\)/);
  });

  it("advertises the balances in the tool description", () => {
    const tool = getContactModule.default();
    assert.match(tool.description, /AR and AP balances/);
    assert.match(tool.description, /base currency/);
  });
});

// --- annotations stay read-only ------------------------------------------

describe("credit note, payment and contact tools stay read-only annotated", () => {
  it("each keeps readOnlyHint", () => {
    for (const factory of [
      creditNotesModule.default,
      getPaymentModule.default,
      getContactModule.default,
    ]) {
      const tool = factory();
      assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
    }
  });
});
