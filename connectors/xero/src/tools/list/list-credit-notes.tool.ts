import { z } from "zod";
import { listXeroCreditNotes } from "../../handlers/list-xero-credit-notes.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { CreditNote } from "xero-node";

export function formatCreditNote(creditNote: CreditNote): string {
  return [
    `Credit Note ID: ${creditNote.creditNoteID}`,
    `Credit Note Number: ${creditNote.creditNoteNumber}`,
    creditNote.reference ? `Reference: ${creditNote.reference}` : null,
    `Type: ${creditNote.type || "Unknown"}`,
    `Status: ${creditNote.status || "Unknown"}`,
    creditNote.contact
      ? `Contact: ${creditNote.contact.name} (${creditNote.contact.contactID})`
      : null,
    creditNote.date ? `Date: ${creditNote.date}` : null,
    creditNote.lineAmountTypes
      ? `Line Amount Types: ${creditNote.lineAmountTypes}`
      : null,
    creditNote.subTotal !== undefined ? `Sub Total: ${creditNote.subTotal}` : null,
    creditNote.totalTax !== undefined ? `Total Tax: ${creditNote.totalTax}` : null,
    creditNote.total !== undefined ? `Total: ${creditNote.total}` : null,
    creditNote.currencyCode ? `Currency: ${creditNote.currencyCode}` : null,
    creditNote.currencyRate ? `Currency Rate: ${creditNote.currencyRate}` : null,
    creditNote.updatedDateUTC
      ? `Last Updated: ${creditNote.updatedDateUTC}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

const ListCreditNotesTool = CreateXeroTool(
  "list_credit_notes",
  "List credit notes in Xero, most recently updated first, 10 per page, \
  optionally for a specific contact. \
  By default only DRAFT, SUBMITTED, AUTHORISED and PAID credit notes are returned: \
  DELETED and VOIDED credit notes are EXCLUDED (their counts are reported in the header), \
  so counts and credit totals computed from a default listing are clean. \
  Pass `statuses` to override — e.g. ['DELETED'] or ['VOIDED'] to inspect removed credit notes. \
  The header reports 'page N of M; T total' from Xero's pagination metadata — \
  trust it over counting returned rows, and call again with the next page number \
  (and the same filters) to paginate.",
  {
    page: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe("Page number, 1-based. Defaults to 1."),
    contactId: z
      .string()
      .guid("contactId must be a valid Xero GUID")
      .optional()
      .describe(
        "Optional ContactID (GUID) to filter credit notes by — from list_contacts.",
      ),
    statuses: z
      .array(z.enum(["DRAFT", "SUBMITTED", "AUTHORISED", "PAID", "VOIDED", "DELETED"]))
      .optional()
      .describe(
        "Filter credit notes by status. Omit to get the default set (DRAFT, SUBMITTED, AUTHORISED, PAID) — DELETED and VOIDED are only returned when explicitly listed here.",
      ),
  },
  async ({ page, contactId, statuses }) => {
    const response = await listXeroCreditNotes(page, contactId, statuses);
    if (response.error !== null) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing credit notes: ${response.error}`,
          },
        ],
      };
    }

    const {
      creditNotes,
      pagination,
      defaultStatusFilterApplied,
      excludedDeleted,
      excludedVoided,
    } = response.result;

    const headerParts: string[] = [];
    headerParts.push(
      pagination?.pageCount !== undefined && pagination?.itemCount !== undefined
        ? `Found ${creditNotes.length} credit notes (page ${page} of ${pagination.pageCount}; ${pagination.itemCount} total matching).`
        : `Found ${creditNotes.length} credit notes (page ${page}; 10 per page — if 10 were returned, more pages may exist).`,
    );
    if (defaultStatusFilterApplied) {
      headerParts.push(
        excludedDeleted !== undefined || excludedVoided !== undefined
          ? `Excluded by default: ${excludedDeleted ?? "?"} DELETED and ${excludedVoided ?? "?"} VOIDED credit notes — pass statuses (e.g. ['DELETED'] or ['VOIDED']) to view them.`
          : "DELETED and VOIDED credit notes are excluded by default (counts reported on page 1) — pass statuses to view them.",
      );
    }
    if (creditNotes.length === 0 && contactId) {
      headerParts.push(
        "Note: Xero returns an empty page (HTTP 200) even when a filtered contact ID does not exist — 0 results does NOT confirm the contact exists. Verify with get_contact.",
      );
    }

    return {
      content: [
        {
          type: "text" as const,
          text: headerParts.join("\n"),
        },
        ...creditNotes.map((creditNote) => ({
          type: "text" as const,
          text: formatCreditNote(creditNote),
        })),
      ],
    };
  },
);

export default ListCreditNotesTool;
