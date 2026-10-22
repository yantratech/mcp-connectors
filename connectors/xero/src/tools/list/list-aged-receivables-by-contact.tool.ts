import { z } from "zod";
import { listXeroAgedReceivablesByContact } from "../../handlers/list-aged-receivables-by-contact.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import {
  AGED_REPORT_MAX_ROWS,
  formatAgedReportRows,
  resolveAgedReportInvoiceWindow,
} from "../../helpers/format-aged-report-filter.js";
import { formatReportHeader } from "../../helpers/format-report-header.js";

const ListAgedReceivablesByContact = CreateXeroTool(
  "list_aged_receivables_by_contact",
  `Lists aged receivables for a contact as at a report date. \
reportDate bounds BOTH payments AND the invoice window (invoices dated after it are excluded unless invoicesToDate widens the window), \
so the Due totals are the true receivable position as at that date; without reportDate, Xero reports as at the end of the current month. \
The effective invoice window is always stated in the output. \
Rows are compact (one line per invoice), capped at ${AGED_REPORT_MAX_ROWS} with an explicit "Showing X of Y" marker; \
Xero's totals row is always included and covers ALL rows regardless of the cap. \
Pass detail:'full' for the raw Xero report rows JSON (very large — 100k+ chars for a busy contact). \
Note: Xero computes "days overdue" notes from today, not from reportDate.`,
  {
    contactId: z.string(),
    reportDate: z.string().optional()
      .describe("Optional as-at date in YYYY-MM-DD format. Bounds payments AND (unless invoicesToDate is provided) the invoice window, so the report shows the true receivable position as at this date. If none is provided, defaults to end of the current month."),
    invoicesFromDate: z.string().optional()
      .describe("Optional from date in YYYY-MM-DD format. If provided, will only show receivable invoices dated on or after this date for the contact."),
    invoicesToDate: z.string().optional()
      .describe("Optional to date in YYYY-MM-DD format. Overrides the invoice-window cutoff, which otherwise defaults to reportDate (or to end of the current month when reportDate is also omitted)."),
    detail: z.enum(["compact", "full"]).optional()
      .describe(`'compact' (default) renders one line per invoice capped at ${AGED_REPORT_MAX_ROWS} rows; 'full' returns the raw Xero report rows JSON (very large — every cell repeats an attributes array).`),
  },
  async ({ contactId, reportDate, invoicesFromDate, invoicesToDate, detail }) => {
    const invoiceWindow = resolveAgedReportInvoiceWindow(reportDate, invoicesFromDate, invoicesToDate);
    const response = await listXeroAgedReceivablesByContact(
      contactId,
      reportDate,
      invoiceWindow.fromDate,
      invoiceWindow.toDate,
    );

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing aged receivables by contact: ${response.error}`,
          },
        ],
      };
    }

    const agedReceivablesReport = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: formatReportHeader(agedReceivablesReport),
        },
        {
          type: "text" as const,
          text: invoiceWindow.windowLine,
        },
        {
          type: "text" as const,
          text:
            detail === "full"
              ? JSON.stringify(agedReceivablesReport.rows ?? [])
              : formatAgedReportRows(agedReceivablesReport),
        },
      ],
    };
  }
);

export default ListAgedReceivablesByContact;
