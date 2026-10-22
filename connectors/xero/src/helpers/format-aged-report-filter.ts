import { ReportCell, ReportWithRow, RowType } from "xero-node";

/**
 * Shared helpers for the two aged-report tools
 * (list_aged_payables_by_contact / list_aged_receivables_by_contact).
 *
 * Xero's aged reports take two INDEPENDENT date filters:
 *  - `date` (our reportDate) bounds PAYMENTS only ("Showing payments to ...");
 *  - `fromDate`/`toDate` bound the INVOICE window, and `toDate` silently
 *    defaults to the end of the CURRENT month.
 * With reportDate alone, invoices raised AFTER the requested date leak into
 * the report and its Due totals (for example, an as-at date whose true
 * balance was zero showed a non-zero Due). resolveAgedReportInvoiceWindow
 * therefore pins `toDate` to reportDate unless the caller widens the window
 * explicitly.
 */

export interface AgedReportInvoiceWindow {
  fromDate?: string;
  toDate?: string;
  /** Human-readable statement of the effective invoice window. */
  windowLine: string;
}

export const resolveAgedReportInvoiceWindow = (
  reportDate?: string,
  invoicesFromDate?: string,
  invoicesToDate?: string,
): AgedReportInvoiceWindow => {
  const fromDate = invoicesFromDate;
  const toDate = invoicesToDate ?? reportDate;

  if (!fromDate && !toDate) {
    return {
      fromDate,
      toDate,
      windowLine:
        "Invoice window: Xero default — all invoices dated up to the end of the CURRENT month.",
    };
  }

  const bounds = [
    fromDate ? `from ${fromDate}` : null,
    toDate ? `to ${toDate}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  let windowLine = `Invoice window: invoices dated ${bounds}`;
  if (!invoicesToDate && reportDate) {
    windowLine +=
      " (cutoff pinned to reportDate so the totals are the true position as at that date; pass invoicesToDate to widen)";
  } else if (!toDate) {
    windowLine +=
      " (no upper bound given — Xero defaults it to the end of the CURRENT month)";
  }
  return { fromDate, toDate, windowLine };
};

/** Default row cap for the compact aged-report rendering. */
export const AGED_REPORT_MAX_ROWS = 50;

// Xero renders dates as "2026-01-15T00:00:00"; the time part carries nothing.
const compactValue = (value?: string): string =>
  (value ?? "").replace(/T00:00:00(\.0+)?$/, "");

const rowInvoiceId = (cells: ReportCell[]): string | undefined => {
  for (const cell of cells) {
    const attribute = cell.attributes?.find(
      (a) => a.id === "invoiceID" && a.value,
    );
    if (attribute) return attribute.value;
  }
  return undefined;
};

/**
 * Renders one report row as "Title: value | ..." pairs. Cells under an
 * untitled column (Xero uses these for currency codes and the "N days
 * overdue" note) are appended to the preceding field. `skipFirstCell` drops
 * a SummaryRow's leading "Total" label cell.
 */
const formatDataRow = (
  columns: string[],
  cells: ReportCell[],
  skipFirstCell = false,
): string => {
  const fields: string[] = [];
  cells.forEach((cell, index) => {
    if (skipFirstCell && index === 0) return;
    const value = compactValue(cell.value);
    const title = columns[index] ?? "";
    if (title) {
      if (value) fields.push(`${title}: ${value}`);
    } else if (value) {
      if (fields.length > 0) fields[fields.length - 1] += ` ${value}`;
      else fields.push(value);
    }
  });
  return fields.join(" | ");
};

/**
 * Compact rendering of an aged report's rows: one line per invoice instead of
 * the raw rows JSON (which repeats an identical invoiceID attributes array in
 * every cell, and can exceed 100k chars for a busy contact). A leading
 * "Showing X of Y" count line and Xero's SummaryRow totals come BEFORE the
 * row lines, so a tail-truncated response loses rows, never the completeness
 * signals; data rows are capped at `maxRows` and the totals are ALWAYS exact
 * regardless of truncation.
 */
export const formatAgedReportRows = (
  report: Pick<ReportWithRow, "rows">,
  maxRows: number = AGED_REPORT_MAX_ROWS,
): string => {
  const topRows = report.rows ?? [];
  const columns = (
    topRows.find((row) => row.rowType === RowType.Header)?.cells ?? []
  ).map((cell) => cell.value ?? "");

  const dataRows: { section?: string; cells: ReportCell[] }[] = [];
  const summaryRows: { section?: string; cells: ReportCell[] }[] = [];
  for (const top of topRows) {
    if (top.rowType === RowType.Section) {
      for (const inner of top.rows ?? []) {
        if (inner.rowType === RowType.Row) {
          dataRows.push({ section: top.title || undefined, cells: inner.cells ?? [] });
        } else if (inner.rowType === RowType.SummaryRow) {
          summaryRows.push({ section: top.title || undefined, cells: inner.cells ?? [] });
        }
      }
    } else if (top.rowType === RowType.Row) {
      dataRows.push({ cells: top.cells ?? [] });
    } else if (top.rowType === RowType.SummaryRow) {
      summaryRows.push({ cells: top.cells ?? [] });
    }
  }

  const shown = dataRows.slice(0, maxRows);
  const lines: string[] = [];
  if (dataRows.length === 0) {
    lines.push("No invoice rows in this window.");
  } else if (dataRows.length > shown.length) {
    lines.push(
      `Showing ${shown.length} of ${dataRows.length} invoice rows ` +
        `(${dataRows.length - shown.length} omitted). The totals below are ` +
        "Xero's and cover ALL rows, shown or omitted. Narrow the window with " +
        "invoicesFromDate/invoicesToDate, or use list_invoices with contactIds " +
        "for paged full detail.",
    );
  } else {
    lines.push(`Showing all ${dataRows.length} invoice rows.`);
  }
  // Xero's totals render BEFORE the rows and are exact regardless of the cap.
  // Each summary row keeps its own section's label, so a multi-section report
  // never captions a section subtotal with the global row count.
  for (const { section, cells } of summaryRows) {
    const label = compactValue(cells[0]?.value) || "Total";
    lines.push(
      `${section ? `${section} — ` : ""}${label}: ${formatDataRow(columns, cells, true)}`,
    );
  }
  let lastSection: string | undefined;
  for (const { section, cells } of shown) {
    if (section && section !== lastSection) {
      lines.push(`Section: ${section}`);
      lastSection = section;
    }
    const invoiceId = rowInvoiceId(cells);
    const rendered = formatDataRow(columns, cells);
    lines.push(invoiceId ? `${rendered} | invoiceID: ${invoiceId}` : rendered);
  }
  return lines.join("\n");
};
