import { ManualJournal } from "xero-node";
import {
  DEFAULT_MANUAL_JOURNAL_ORDER,
  listXeroManualJournals,
  MANUAL_JOURNAL_ORDERS,
} from "../../handlers/list-xero-manual-journals.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import {
  formatManualJournalLineDrCr,
  formatManualJournalLineTrackingRow,
} from "../../helpers/format-manual-journal-line.js";
import { z } from "zod";

export function formatManualJournal(journal: ManualJournal): string {
  return [
    `Manual Journal ID: ${journal.manualJournalID}`,
    journal.narration
      ? `Description: ${journal.narration}`
      : "No description",
    journal.date ? `Date: ${journal.date}` : null,
    journal.journalLines
      ? journal.journalLines.map((line) =>
          [
            `Line Amount: ${line.lineAmount} (${formatManualJournalLineDrCr(line)})`,
            line.accountCode
              ? `Account Code: ${line.accountCode}`
              : "No account code",
            line.description
              ? `Description: ${line.description}`
              : "No description",
            line.taxType ? `Tax Type: ${line.taxType}` : "No tax type",
            `Tax Amount: ${line.taxAmount}`,
            formatManualJournalLineTrackingRow(line),
          ]
            .filter(Boolean)
            .join("\n")
        ).join("\n\n")
      : "No journal lines",
    journal.lineAmountTypes
      ? `Line Amount Types: ${journal.lineAmountTypes}`
      : "No line amount types",
    journal.status ? `Status: ${journal.status}` : "No status",
    journal.url ? `URL: ${journal.url}` : "No URL",
    `Show on Cash Basis Reports: ${journal.showOnCashBasisReports}`,
    `Has Attachments: ${journal.hasAttachments}`,
    journal.updatedDateUTC
      ? `Last Updated: ${journal.updatedDateUTC}`
      : "No last updated date",
  ]
    .filter(Boolean)
    .join("\n");
}

const ListManualJournalsTool = CreateXeroTool(
  "list_manual_journals",
  `List manual journals in Xero, 10 per page, most recently updated first unless
'order' is given (UpdatedDateUTC or Date, ASC or DESC).
Filter by journal date with dateFrom/dateTo (inclusive, YYYY-MM-DD).
By default only DRAFT, POSTED and ARCHIVED manual journals are returned:
DELETED and VOIDED journals (which have zero ledger effect) are EXCLUDED
(their counts are reported in the header), so totals computed from a default
listing are clean. Pass statuses to override — e.g. ['DELETED'] or ['VOIDED']
to inspect removed journals.
Line amounts follow Xero's sign convention — positive = debit, negative =
credit — and each line is rendered with an explicit Dr:/Cr: split.
The header reports 'page N of M; T total' from Xero's pagination metadata —
trust it over counting returned rows, and call again with the next page number
(and the same filters) to paginate.
Can optionally pass a manual journal ID to retrieve one specific journal
(bypasses status, date and order filtering, and pagination), or modifiedAfter
to filter journals modified after that date.
Each journal line shows its tracking categories when it has any.`,
  {
    manualJournalId: z
      .string()
      .optional()
      .describe("Optional ID of the manual journal to retrieve"),
    modifiedAfter: z
      .string()
      .optional()
      .describe(
        "Optional date YYYY-MM-DD to filter journals modified after this date",
      ),
    page: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe("Page number, 1-based. Defaults to 1."),
    statuses: z
      .array(z.enum(["DRAFT", "POSTED", "ARCHIVED", "VOIDED", "DELETED"]))
      .optional()
      .describe(
        "Filter manual journals by status. Omit to get the default set (DRAFT, POSTED, ARCHIVED) — DELETED and VOIDED are only returned when explicitly listed here.",
      ),
    dateFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "dateFrom must be YYYY-MM-DD")
      .optional()
      .describe(
        "Optional: only journals dated on or after this date (YYYY-MM-DD, inclusive). Filters on the journal's Date, not when it was modified.",
      ),
    dateTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "dateTo must be YYYY-MM-DD")
      .optional()
      .describe(
        "Optional: only journals dated on or before this date (YYYY-MM-DD, inclusive).",
      ),
    order: z
      .enum(MANUAL_JOURNAL_ORDERS)
      .optional()
      .describe(
        `Optional sort order. Defaults to "${DEFAULT_MANUAL_JOURNAL_ORDER}" (most recently updated first).`,
      ),
  },
  async (args) => {
    const response = await listXeroManualJournals(
      args?.page,
      args?.manualJournalId,
      args?.modifiedAfter,
      args?.statuses,
      { dateFrom: args?.dateFrom, dateTo: args?.dateTo, order: args?.order },
    );

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing manual journals: ${response.error}`,
          },
        ],
      };
    }

    const {
      manualJournals,
      pagination,
      defaultStatusFilterApplied,
      excludedDeleted,
      excludedVoided,
    } = response.result;

    const headerParts: string[] = [];
    if (args?.manualJournalId) {
      headerParts.push(
        `Found ${manualJournals.length} manual journals (fetched by ID).`,
      );
    } else {
      headerParts.push(
        pagination?.pageCount !== undefined && pagination?.itemCount !== undefined
          ? `Found ${manualJournals.length} manual journals (page ${args?.page} of ${pagination.pageCount}; ${pagination.itemCount} total matching).`
          : `Found ${manualJournals.length} manual journals (page ${args?.page}; 10 per page — if 10 were returned, more pages may exist).`,
      );
    }
    if (!args?.manualJournalId && (args?.dateFrom || args?.dateTo)) {
      headerParts.push(
        `Journal date filter: ${args?.dateFrom ?? "any"} to ${args?.dateTo ?? "any"} (inclusive).`,
      );
    }
    if (!args?.manualJournalId && args?.order) {
      headerParts.push(`Sorted by ${args.order}.`);
    }
    if (defaultStatusFilterApplied) {
      headerParts.push(
        excludedDeleted !== undefined || excludedVoided !== undefined
          ? `Excluded by default: ${excludedDeleted ?? "?"} DELETED and ${excludedVoided ?? "?"} VOIDED manual journals (zero ledger effect) — pass statuses (e.g. ['DELETED'] or ['VOIDED']) to view them.`
          : "DELETED and VOIDED manual journals are excluded by default (counts reported on page 1) — pass statuses to view them.",
      );
    }
    if (manualJournals.length > 0) {
      headerParts.push(
        "Line amounts: positive = debit, negative = credit (Dr:/Cr: shown per line).",
      );
    }

    return {
      content: [
        {
          type: "text" as const,
          text: headerParts.join("\n"),
        },
        ...manualJournals.map((journal) => ({
          type: "text" as const,
          text: formatManualJournal(journal),
        })),
      ],
    };
  },
);

export default ListManualJournalsTool;
