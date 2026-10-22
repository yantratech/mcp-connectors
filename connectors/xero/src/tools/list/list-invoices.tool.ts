import { z } from "zod";
import { listXeroInvoices } from "../../handlers/list-xero-invoices.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { formatLineItem } from "../../helpers/format-line-item.js";
import { Invoice } from "xero-node";

export function formatInvoice(
  invoice: Invoice,
  returnLineItems: boolean,
): string {
  return [
    `Invoice ID: ${invoice.invoiceID}`,
    invoice.invoiceNumber ? `Invoice Number: ${invoice.invoiceNumber}` : null,
    invoice.reference ? `Reference: ${invoice.reference}` : null,
    `Type: ${invoice.type || "Unknown"}`,
    `Status: ${invoice.status || "Unknown"}`,
    invoice.contact
      ? `Contact: ${invoice.contact.name} (${invoice.contact.contactID})`
      : null,
    invoice.date ? `Date: ${invoice.date}` : null,
    invoice.dueDate ? `Due Date: ${invoice.dueDate}` : null,
    invoice.lineAmountTypes
      ? `Line Amount Types: ${invoice.lineAmountTypes}`
      : null,
    invoice.subTotal !== undefined ? `Sub Total: ${invoice.subTotal}` : null,
    invoice.totalTax !== undefined ? `Total Tax: ${invoice.totalTax}` : null,
    invoice.total !== undefined ? `Total: ${invoice.total}` : null,
    invoice.totalDiscount !== undefined
      ? `Total Discount: ${invoice.totalDiscount}`
      : null,
    invoice.currencyCode ? `Currency: ${invoice.currencyCode}` : null,
    invoice.currencyRate ? `Currency Rate: ${invoice.currencyRate}` : null,
    invoice.updatedDateUTC ? `Last Updated: ${invoice.updatedDateUTC}` : null,
    invoice.fullyPaidOnDate ? `Fully Paid On: ${invoice.fullyPaidOnDate}` : null,
    invoice.amountDue !== undefined ? `Amount Due: ${invoice.amountDue}` : null,
    invoice.amountPaid !== undefined
      ? `Amount Paid: ${invoice.amountPaid}`
      : null,
    invoice.amountCredited !== undefined
      ? `Amount Credited: ${invoice.amountCredited}`
      : null,
    invoice.hasErrors ? "Has Errors: Yes" : null,
    invoice.isDiscounted ? "Is Discounted: Yes" : null,
    returnLineItems && invoice.lineItems?.length
      ? `Line Items:\n${invoice.lineItems.map(formatLineItem).join("\n")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

const ListInvoicesTool = CreateXeroTool(
  "list_invoices",
  "List invoices in Xero, most recently updated first, 10 per page. \
  By default only DRAFT, SUBMITTED, AUTHORISED and PAID invoices are returned: \
  DELETED and VOIDED invoices are EXCLUDED (their counts are reported in the header), \
  so counts and totals computed from a default listing are clean. \
  Pass `statuses` to override — e.g. ['AUTHORISED'] for invoices ready for payment, \
  ['DELETED'] or ['VOIDED'] to inspect removed invoices. \
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
    contactIds: z.array(z.string()).optional(),
    invoiceNumbers: z
      .array(z.string())
      .optional()
      .describe("If provided, invoice line items will also be returned"),
    statuses: z
      .array(z.enum(["DRAFT", "SUBMITTED", "AUTHORISED", "PAID", "VOIDED", "DELETED"]))
      .optional()
      .describe(
        "Filter invoices by status. Omit to get the default set (DRAFT, SUBMITTED, AUTHORISED, PAID) — DELETED and VOIDED are only returned when explicitly listed here.",
      ),
  },
  async ({ page, contactIds, invoiceNumbers, statuses }) => {
    const response = await listXeroInvoices(page, contactIds, invoiceNumbers, statuses);
    if (response.error !== null) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing invoices: ${response.error}`,
          },
        ],
      };
    }

    const {
      invoices,
      pagination,
      defaultStatusFilterApplied,
      excludedDeleted,
      excludedVoided,
    } = response.result;
    const returnLineItems = (invoiceNumbers?.length ?? 0) > 0;

    const headerParts: string[] = [];
    headerParts.push(
      pagination?.pageCount !== undefined && pagination?.itemCount !== undefined
        ? `Found ${invoices.length} invoices (page ${page} of ${pagination.pageCount}; ${pagination.itemCount} total matching).`
        : `Found ${invoices.length} invoices (page ${page}; 10 per page — if 10 were returned, more pages may exist).`,
    );
    if (defaultStatusFilterApplied) {
      headerParts.push(
        excludedDeleted !== undefined || excludedVoided !== undefined
          ? `Excluded by default: ${excludedDeleted ?? "?"} DELETED and ${excludedVoided ?? "?"} VOIDED invoices — pass statuses (e.g. ['DELETED'] or ['VOIDED']) to view them.`
          : "DELETED and VOIDED invoices are excluded by default (counts reported on page 1) — pass statuses to view them.",
      );
    }
    if (
      invoices.length === 0 &&
      ((contactIds?.length ?? 0) > 0 || (invoiceNumbers?.length ?? 0) > 0)
    ) {
      headerParts.push(
        "Note: Xero returns an empty page (HTTP 200) even when a filtered contact ID or invoice number does not exist — 0 results does NOT confirm the contact/invoice exists. Verify with get_contact or get_invoice.",
      );
    }

    return {
      content: [
        {
          type: "text" as const,
          text: headerParts.join("\n"),
        },
        ...invoices.map((invoice) => ({
          type: "text" as const,
          text: formatInvoice(invoice, returnLineItems),
        })),
      ],
    };
  },
);

export default ListInvoicesTool;
