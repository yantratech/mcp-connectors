/**
 * Offline tests for the two aged-report tools
 * (list_aged_payables_by_contact / list_aged_receivables_by_contact):
 *
 *  - Invoice window pinned to reportDate: Xero's aged reports bound PAYMENTS
 *    with `date` but bound the INVOICE window with `toDate`, which silently
 *    defaults to the end of the CURRENT month, so reportDate alone would
 *    return invoices raised after the requested date (e.g. a reportDate whose
 *    as-at balance is zero could still show a Due amount). The window is
 *    pinned to reportDate unless invoicesToDate widens it, the effective
 *    window is stated in the output, and the descriptions explain the real
 *    semantics.
 *  - Compact rendering of large reports: the raw rows JSON repeats the same
 *    invoiceID attribute array in every cell, so it can exceed 100k
 *    characters for a busy contact. Rows are compact one-liners capped at 50
 *    with an explicit "Showing X of Y" marker, Xero's totals row is always
 *    rendered, and detail:'full' returns the raw JSON on request.
 *
 * Everything runs against pure exported helpers and zod schemas from
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
const {
  AGED_REPORT_MAX_ROWS,
  formatAgedReportRows,
  resolveAgedReportInvoiceWindow,
} = await import("../dist/helpers/format-aged-report-filter.js");
const { default: agedPayablesFactory } = await import(
  "../dist/tools/list/list-aged-payables-by-contact.tool.js"
);
const { default: agedReceivablesFactory } = await import(
  "../dist/tools/list/list-aged-receivables-by-contact.tool.js"
);

const schemaOf = (factory) => z.object(factory().schema);

// ---------------------------------------------------------------------------
// Fixtures shaped like Xero's GET /Reports/AgedPayablesByContact response: a
// 13-column header with untitled currency columns, one Section of Rows, and a
// SummaryRow; every cell of every data row repeats the identical invoiceID
// attribute. All values are synthetic.
// ---------------------------------------------------------------------------

const cell = (value, invoiceId) =>
  invoiceId
    ? { value, attributes: [{ id: "invoiceID", value: invoiceId }] }
    : { value };

const HEADER = {
  rowType: "Header",
  cells: [
    cell("Date"),
    cell("Reference"),
    cell("Due Date"),
    cell(""),
    cell("Total"),
    cell(""),
    cell("Paid"),
    cell(""),
    cell("Credited"),
    cell(""),
    cell("Due"),
    cell(""),
    cell("Due GBP"),
  ],
};

const invoiceRow = (n, { date, reference, dueDate, overdue, total, paid, credited, due, dueGbp }) => {
  const id = `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  return {
    rowType: "Row",
    cells: [
      cell(date, id),
      cell(reference ?? "", id),
      cell(dueDate, id),
      cell(overdue ?? "", id),
      cell(total, id),
      cell("USD", id),
      cell(paid, id),
      cell("USD", id),
      cell(credited, id),
      cell("USD", id),
      cell(due, id),
      cell("USD", id),
      cell(dueGbp, id),
    ],
  };
};

const summaryRow = (dueGbp) => ({
  rowType: "SummaryRow",
  cells: [
    cell("Total"),
    cell(""),
    cell(""),
    cell(""),
    cell(""),
    cell(""),
    cell(""),
    cell(""),
    cell(""),
    cell(""),
    cell(""),
    cell(""),
    cell(dueGbp),
  ],
});

const makeReport = (rowCount, dueGbpTotal) => ({
  rows: [
    HEADER,
    {
      rowType: "Section",
      title: "",
      rows: [
        ...Array.from({ length: rowCount }, (_, i) =>
          invoiceRow(i + 1, {
            date: "2026-01-15T00:00:00",
            dueDate: "2026-01-15T00:00:00",
            overdue: i === 0 ? "30 days overdue" : "",
            total: "1000.00",
            paid: "1000.00",
            credited: "0.00",
            due: "0.00",
            dueGbp: "0.00",
          }),
        ),
        summaryRow(dueGbpTotal),
      ],
    },
  ],
});

describe("resolveAgedReportInvoiceWindow (window pinned to reportDate)", () => {
  it("pins toDate to reportDate when invoicesToDate is omitted (never leaves it undefined)", () => {
    const window = resolveAgedReportInvoiceWindow("2026-03-31", undefined, undefined);
    // Sending toDate=undefined would let Xero default the invoice window to
    // the end of the CURRENT month.
    assert.equal(window.toDate, "2026-03-31");
    assert.equal(window.fromDate, undefined);
  });

  it("states the pinned window and how to widen it", () => {
    const window = resolveAgedReportInvoiceWindow("2026-03-31", undefined, undefined);
    assert.match(window.windowLine, /Invoice window: invoices dated to 2026-03-31/);
    assert.match(window.windowLine, /pinned to reportDate/);
    assert.match(window.windowLine, /invoicesToDate to widen/);
  });

  it("lets an explicit invoicesToDate override the reportDate cutoff", () => {
    const window = resolveAgedReportInvoiceWindow("2026-03-31", "2026-01-01", "2026-08-31");
    assert.equal(window.toDate, "2026-08-31");
    assert.equal(window.fromDate, "2026-01-01");
    assert.match(window.windowLine, /from 2026-01-01 to 2026-08-31/);
    assert.doesNotMatch(window.windowLine, /pinned to reportDate/);
  });

  it("with no dates at all, states Xero's current-month default instead of implying a bound", () => {
    const window = resolveAgedReportInvoiceWindow(undefined, undefined, undefined);
    assert.equal(window.toDate, undefined);
    assert.match(window.windowLine, /Xero default/);
    assert.match(window.windowLine, /CURRENT month/);
  });

  it("flags a from-only window as unbounded above", () => {
    const window = resolveAgedReportInvoiceWindow(undefined, "2026-01-01", undefined);
    assert.equal(window.toDate, undefined);
    assert.match(window.windowLine, /from 2026-01-01/);
    assert.match(window.windowLine, /no upper bound/);
    assert.match(window.windowLine, /CURRENT month/);
  });
});

describe("formatAgedReportRows (compact rows, explicit cap, exact totals)", () => {
  it("renders one labelled line per invoice with the invoiceID exactly once", () => {
    const text = formatAgedReportRows(makeReport(2, "0.00"));
    // Leading count line and totals come BEFORE the row lines.
    const lines = text.split("\n");
    assert.equal(lines[0], "Showing all 2 invoice rows.");
    const first = lines[2];
    assert.match(first, /Date: 2026-01-15 \| Due Date: 2026-01-15 30 days overdue \| Total: 1000\.00 USD/);
    assert.match(first, /Paid: 1000\.00 USD \| Credited: 0\.00 USD \| Due: 0\.00 USD \| Due GBP: 0\.00/);
    assert.match(first, /invoiceID: 00000000-0000-0000-0000-000000000001$/);
    // One mention per row, not one per cell (the raw shape repeats it 13x).
    assert.equal(text.match(/invoiceID/g).length, 2);
  });

  it("never emits the raw JSON cell shape", () => {
    const text = formatAgedReportRows(makeReport(3, "0.00"));
    assert.doesNotMatch(text, /"attributes"/);
    assert.doesNotMatch(text, /"value":/);
    assert.doesNotMatch(text, /rowType/);
    assert.doesNotMatch(text, /T00:00:00/);
  });

  it("caps at 50 rows by default with a LEADING 'Showing X of Y' marker", () => {
    const text = formatAgedReportRows(makeReport(83, "500.00"));
    assert.equal(AGED_REPORT_MAX_ROWS, 50);
    // Counts-before-arrays: the truncation marker opens the rendering, so a
    // tail-truncated response loses rows, never the warning.
    assert.match(text, /^Showing 50 of 83 invoice rows \(33 omitted\)/);
    assert.match(text, /invoicesFromDate\/invoicesToDate/);
    assert.match(text, /list_invoices/);
    assert.match(text, /cover ALL rows/);
  });

  it("always renders Xero's totals BEFORE the rows, exact regardless of truncation", () => {
    const text = formatAgedReportRows(makeReport(83, "500.00"));
    const lines = text.split("\n");
    assert.equal(lines[1], "Total: Due GBP: 500.00");
    // The summary's leading "Total" label cell must not masquerade as a Date.
    assert.doesNotMatch(text, /Date: Total/);
  });

  it("collapses a large report to well under a fifth of its raw size", () => {
    const report = makeReport(83, "500.00");
    const rawLength = JSON.stringify(report.rows).length;
    const compactLength = formatAgedReportRows(report).length;
    assert.ok(rawLength > 50_000, `fixture must be large (${rawLength})`);
    assert.ok(
      compactLength < rawLength / 5,
      `compact (${compactLength}) must be <1/5 of raw (${rawLength})`,
    );
  });

  it("shows no truncation marker when everything fits, and states when there are zero rows", () => {
    const small = formatAgedReportRows(makeReport(3, "0.00"));
    assert.doesNotMatch(small, /Showing \d+ of/);
    assert.match(small, /^Showing all 3 invoice rows\./);
    assert.match(small, /Total: Due GBP: 0\.00/);
    const empty = formatAgedReportRows({ rows: [HEADER] });
    assert.match(empty, /No invoice rows in this window\./);
  });

  it("honours an explicit maxRows", () => {
    const text = formatAgedReportRows(makeReport(10, "0.00"), 4);
    assert.match(text, /^Showing 4 of 10 invoice rows \(6 omitted\)/);
  });
});

describe("aged-report tool schemas and descriptions", () => {
  for (const factory of [agedPayablesFactory, agedReceivablesFactory]) {
    const tool = factory();

    it(`${tool.name} description explains the reportDate semantics`, () => {
      assert.match(tool.description, /bounds BOTH payments AND the invoice window/);
      assert.match(tool.description, /as at that date/);
      // The previous description ("...up to a report date.") did not mention
      // the separate invoice window.
      assert.doesNotMatch(tool.description, /certain contact up to a report date/);
      // Xero-side residual quirk stays disclosed.
      assert.match(tool.description, /"days overdue" notes from today/);
    });

    it(`${tool.name} description discloses the cap and the detail:'full' escape hatch`, () => {
      assert.match(tool.description, /capped at 50/);
      assert.match(tool.description, /Showing X of Y/);
      assert.match(tool.description, /detail:'full'/);
      assert.match(tool.description, /covers ALL rows/);
    });

    it(`${tool.name} schema gains detail and documents the window override`, () => {
      const s = schemaOf(factory);
      assert.equal(s.safeParse({ contactId: "c-1" }).success, true);
      assert.equal(s.safeParse({ contactId: "c-1", detail: "compact" }).success, true);
      assert.equal(s.safeParse({ contactId: "c-1", detail: "full" }).success, true);
      assert.equal(s.safeParse({ contactId: "c-1", detail: "everything" }).success, false);
      assert.match(factory().schema.reportDate.description, /invoice window/);
      assert.match(factory().schema.invoicesToDate.description, /defaults to reportDate/);
    });

    it(`${tool.name} stays read-only annotated`, () => {
      assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
    });
  }
});
