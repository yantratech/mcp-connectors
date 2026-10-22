/**
 * Offline tests for report headers, journal rendering and the list-tool
 * formatters:
 *
 *  - default exclusion of DELETED/VOIDED records (schema + description level);
 *  - report headers built from reportTitles with the generation date labelled
 *    "Generated:" (never "Date:"/"Date Range:") and the accounting basis shown;
 *  - journal lines rendered from netAmount (tax split out, never double-counted);
 *  - formatter accuracy: no literal "undefined", zeros not dropped, statuses
 *    and currencies labelled.
 *
 * Everything runs against pure exported formatters and zod schemas from
 * compiled dist/ — no network, no live API.
 *
 * Run via `npm test` (node --test test/*.test.mjs) after `npm run build`.
 */
process.env.XERO_CLIENT_ID = "offline-test-id";
process.env.XERO_CLIENT_SECRET = "offline-test-secret";
process.env.XERO_CLIENT_BEARER_TOKEN = "";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

// Dynamic imports so the env assignments above run first (static imports
// are hoisted ahead of them).
const { formatReportHeader } = await import(
  "../dist/helpers/format-report-header.js"
);
const invoicesModule = await import("../dist/tools/list/list-invoices.tool.js");
const bankTxModule = await import(
  "../dist/tools/list/list-bank-transactions.tool.js"
);
const journalsModule = await import("../dist/tools/list/list-journals.tool.js");
const paymentsModule = await import("../dist/tools/list/list-payments.tool.js");
const contactsModule = await import("../dist/tools/list/list-contacts.tool.js");
const { default: trialBalanceFactory } = await import(
  "../dist/tools/list/list-trial-balance.tool.js"
);
const { default: profitAndLossFactory } = await import(
  "../dist/tools/list/list-profit-and-loss.tool.js"
);
const { default: balanceSheetFactory } = await import(
  "../dist/tools/list/list-report-balance-sheet.tool.js"
);

const schemaOf = (factory) => z.object(factory().schema);

describe("formatReportHeader (period from reportTitles, explicit labels)", () => {
  const report = {
    reportName: "Trial Balance",
    reportTitles: [
      "Trial Balance",
      "Example Org Ltd",
      "As at 31 March 2026",
    ],
    reportDate: "30 July 2026",
  };

  it("leads with the reportTitles (which carry the true period)", () => {
    const header = formatReportHeader(report);
    assert.ok(header.startsWith("Report: Trial Balance | Example Org Ltd | As at 31 March 2026"));
  });

  it("labels the generation date 'Generated:' and never 'Date:'/'Date Range:'", () => {
    const header = formatReportHeader(report);
    assert.match(header, /Generated: 30 July 2026/);
    assert.doesNotMatch(header, /^Date:/m);
    assert.doesNotMatch(header, /Date Range:/);
    assert.match(header, /NOT the reporting period/);
  });

  it("states the accounting basis when asked", () => {
    assert.match(
      formatReportHeader(report, { showBasis: true }),
      /Basis: accrual/,
    );
    assert.match(
      formatReportHeader(report, { showBasis: true, paymentsOnly: true }),
      /Basis: cash/,
    );
    assert.doesNotMatch(formatReportHeader(report), /Basis:/);
  });

  it("flags a missing period instead of inventing one", () => {
    const header = formatReportHeader({
      reportName: "Trial Balance",
      reportDate: "30 July 2026",
    });
    assert.match(header, /reporting period not stated/);
  });
});

describe("report tool descriptions (paymentsOnly = cash basis)", () => {
  for (const factory of [trialBalanceFactory, profitAndLossFactory, balanceSheetFactory]) {
    const tool = factory();
    it(`${tool.name} describes paymentsOnly as the cash-basis toggle`, () => {
      const paymentsOnly = tool.schema.paymentsOnly;
      assert.ok(paymentsOnly, `${tool.name} must keep the paymentsOnly param`);
      assert.match(paymentsOnly.description, /cash basis/i);
      assert.match(tool.description, /accrual/i);
    });
  }
});

describe("formatJournal (net-of-tax rendering, no double-counted tax)", () => {
  // Synthetic tax-bearing bill journal: gross sums to +4 (the tax), net
  // sums to 0.
  const journal = {
    journalID: "j-1001",
    journalNumber: 1001,
    journalDate: "2026-01-01",
    sourceType: "ACCPAY",
    journalLines: [
      { accountCode: "800", accountName: "Accounts Payable", netAmount: -24, grossAmount: -24, taxAmount: 0 },
      {
        accountCode: "429",
        accountName: "General Expenses",
        netAmount: 20,
        grossAmount: 24,
        taxAmount: 4,
        taxName: "20% (VAT on Expenses)",
      },
      { accountCode: "820", accountName: "VAT", netAmount: 4, grossAmount: 4, taxAmount: 0 },
    ],
  };

  it("renders Dr/Cr from netAmount so the journal balances", () => {
    const text = journalsModule.formatJournal(journal);
    // The expense line must show net 20, not gross 24, as the debit.
    assert.match(text, /429 General Expenses\s+Dr:20 Cr:0/);
    assert.match(text, /800 Accounts Payable\s+Dr:0 Cr:24/);
    assert.match(text, /820 VAT\s+Dr:4 Cr:0/);
    // Rendered debits (20 + 4) equal rendered credits (24).
    const drs = [...text.matchAll(/Dr:([\d.]+)/g)].map((m) => Number(m[1]));
    const crs = [...text.matchAll(/Cr:([\d.]+)/g)].map((m) => Number(m[1]));
    assert.equal(
      drs.reduce((a, b) => a + b, 0),
      crs.reduce((a, b) => a + b, 0),
    );
  });

  it("shows tax separately with its name and the gross amount", () => {
    const text = journalsModule.formatJournal(journal);
    assert.match(text, /Tax:4 \(20% \(VAT on Expenses\)\) Gross:24/);
    assert.match(text, /Lines \(net of tax\):/);
  });

  it("never prints a literal 'undefined' account code", () => {
    const text = journalsModule.formatJournal({
      journalID: "j-1",
      journalNumber: 1,
      journalLines: [{ netAmount: 5, grossAmount: 5, taxAmount: 0 }],
    });
    assert.doesNotMatch(text, /undefined/);
    assert.match(text, /\(no account\)/);
  });
});

describe("list_journals description (oldest-first caveat)", () => {
  it("warns that journals come oldest-first and explains offset paging", () => {
    const tool = journalsModule.default();
    assert.match(tool.description, /OLDEST FIRST/);
    assert.match(tool.description, /NOT recent activity/);
    assert.match(tool.schema.offset.description, /GREATER THAN/);
  });
});

describe("formatInvoice (no literal 'undefined', zeros preserved)", () => {
  it("omits the invoice-number line when Xero has none", () => {
    const text = invoicesModule.formatInvoice(
      { invoiceID: "i-1", type: "ACCPAY", status: "PAID", total: 10 },
      false,
    );
    assert.doesNotMatch(text, /undefined/);
    assert.doesNotMatch(text, /Invoice Number:/);
  });

  it("renders legitimate zero amounts instead of dropping them", () => {
    const text = invoicesModule.formatInvoice(
      {
        invoiceID: "i-2",
        invoiceNumber: "INV-1",
        status: "PAID",
        total: 120,
        amountDue: 0,
        amountPaid: 120,
        totalTax: 0,
      },
      false,
    );
    assert.match(text, /Amount Due: 0/);
    assert.match(text, /Total Tax: 0/);
    assert.match(text, /Status: PAID/);
  });
});

describe("formatBankTransaction (labelled status)", () => {
  it("labels the status line and the reconciliation flag", () => {
    const text = bankTxModule.formatBankTransaction({
      bankTransactionID: "bt-1",
      status: "DELETED",
      isReconciled: false,
      total: 151.99,
      currencyCode: "GBP",
    });
    assert.match(text, /Status: DELETED/);
    assert.match(text, /Reconciled: No/);
    assert.doesNotMatch(text, /^DELETED$/m);
  });

  it("keeps a zero total visible", () => {
    const text = bankTxModule.formatBankTransaction({
      bankTransactionID: "bt-2",
      status: "AUTHORISED",
      total: 0,
    });
    assert.match(text, /Total: 0/);
  });

  it("description says coded transactions, not the raw feed", () => {
    const tool = bankTxModule.default();
    assert.match(tool.description, /NOT the raw bank-statement feed/);
    assert.match(tool.description, /list_payments/);
  });
});

describe("formatPayment (currency on monetary lines)", () => {
  it("appends the invoice currency to the amount", () => {
    const text = paymentsModule.formatPayment({
      paymentID: "p-1",
      date: "2026-07-01",
      amount: 320.5,
      bankAmount: 320.5,
      currencyRate: 1,
      status: "AUTHORISED",
      invoice: { invoiceID: "i-1", invoiceNumber: "INV-9", currencyCode: "USD", total: 320.5 },
    });
    assert.match(text, /Amount: 320\.5 USD/);
    assert.match(text, /Total: 320\.5 USD/);
    // Same-currency payment: no cross-currency noise.
    assert.doesNotMatch(text, /Bank Amount:/);
    assert.doesNotMatch(text, /Currency Rate:/);
  });

  it("shows bank amount and rate for cross-currency payments", () => {
    const text = paymentsModule.formatPayment({
      paymentID: "p-2",
      date: "2026-07-01",
      amount: 100,
      bankAmount: 79.4,
      currencyRate: 0.794,
      status: "AUTHORISED",
      invoice: { invoiceID: "i-2", invoiceNumber: "INV-10", currencyCode: "USD" },
    });
    assert.match(text, /Amount: 100 USD/);
    assert.match(text, /Bank Amount: 79\.4/);
    assert.match(text, /Currency Rate: 0\.794/);
  });
});

describe("formatContact (both-false Customer/Supplier is not 'Unknown')", () => {
  it("explains the not-yet-classified state instead of claiming ignorance", () => {
    const text = contactsModule.formatContact({
      contactID: "c-1",
      name: "Example Supplier Ltd",
      isCustomer: false,
      isSupplier: false,
      contactStatus: "ACTIVE",
    });
    assert.match(text, /Type: Not yet classified/);
    assert.match(text, /bank transactions/);
    assert.doesNotMatch(text, /Type: Unknown/);
  });

  it("still renders real classifications", () => {
    const text = contactsModule.formatContact({
      contactID: "c-2",
      name: "Acme",
      isCustomer: true,
      isSupplier: true,
      contactStatus: "ACTIVE",
    });
    assert.match(text, /Type: Customer, Supplier/);
  });
});

describe("list tool schemas (status filters, include flags, page defaults)", () => {
  it("list_invoices keeps the statuses enum incl. DELETED/VOIDED and defaults page to 1", () => {
    const s = schemaOf(invoicesModule.default);
    assert.equal(s.parse({}).page, 1);
    assert.equal(
      s.safeParse({ statuses: ["DELETED", "VOIDED"] }).success,
      true,
    );
    assert.equal(s.safeParse({ statuses: ["BOGUS"] }).success, false);
    const tool = invoicesModule.default();
    assert.match(tool.description, /DELETED and VOIDED invoices are EXCLUDED/);
  });

  it("list_bank_transactions accepts includeDeleted", () => {
    const s = schemaOf(bankTxModule.default);
    assert.equal(s.safeParse({ includeDeleted: true }).success, true);
    assert.equal(s.parse({}).page, 1);
  });

  it("list_payments accepts includeDeleted and still requires GUID ids", () => {
    const s = schemaOf(paymentsModule.default);
    assert.equal(s.safeParse({ includeDeleted: true }).success, true);
    assert.equal(s.safeParse({ invoiceId: "not-a-guid" }).success, false);
  });

  it("list_contacts defaults page to 1 and accepts includeArchived", () => {
    const s = schemaOf(contactsModule.default);
    assert.equal(s.parse({}).page, 1);
    assert.equal(s.safeParse({ includeArchived: true }).success, true);
  });
});

describe("formatLineItem (no literal 'undefined' in line items)", () => {
  it("omits absent fields and keeps zeros", async () => {
    const { formatLineItem } = await import(
      "../dist/helpers/format-line-item.js"
    );
    const text = formatLineItem({
      description: "Daily interest",
      quantity: 1,
      unitAmount: 0,
      accountCode: "270",
    });
    assert.doesNotMatch(text, /undefined/);
    assert.match(text, /Unit Amount: 0/);
    assert.doesNotMatch(text, /Item Code:/);
  });
});

describe("deep links (no stray whitespace before the URL)", () => {
  it("every deep-link builder returns a bare https URL", async () => {
    const links = await import("../dist/consts/deeplinks.js");
    const urls = [
      links.invoiceDeepLink("!abc12", "i-1"),
      links.contactDeepLink("!abc12", "c-1"),
      links.creditNoteDeepLink("!abc12", "cn-1"),
      links.quoteDeepLink("!abc12", "q-1"),
      links.paymentDeepLink("!abc12", "p-1"),
      links.bankTransactionDeepLink("a-1", "bt-1"),
      links.manualJournalDeepLink("mj-1"),
      links.billDeepLink("!abc12", "b-1"),
    ];
    for (const url of urls) {
      assert.match(url, /^https:\/\/go\.xero\.com\//, JSON.stringify(url));
    }
  });
});

describe("list and report tools stay read-only annotated", () => {
  it("every list and report tool tested here keeps readOnlyHint", () => {
    for (const factory of [
      invoicesModule.default,
      bankTxModule.default,
      journalsModule.default,
      paymentsModule.default,
      contactsModule.default,
      trialBalanceFactory,
      profitAndLossFactory,
      balanceSheetFactory,
    ]) {
      const tool = factory();
      assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
    }
  });
});
