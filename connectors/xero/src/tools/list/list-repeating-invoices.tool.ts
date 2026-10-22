import { z } from "zod";
import { listXeroRepeatingInvoices } from "../../handlers/list-xero-repeating-invoices.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { formatLineItem } from "../../helpers/format-line-item.js";

const ListRepeatingInvoicesTool = CreateXeroTool(
  "list_repeating_invoices",
  "List repeating (recurring) invoices in Xero. These are templates that auto-generate \
  invoices on a schedule. Returns both ACCREC (sales) and ACCPAY (bills) repeating invoices.",
  {
    status: z
      .enum(["DRAFT", "AUTHORISED"])
      .optional()
      .describe("Filter by status. DRAFT or AUTHORISED."),
  },
  async ({ status }) => {
    const where = status ? `Status=="${status}"` : undefined;
    const response = await listXeroRepeatingInvoices(where);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing repeating invoices: ${response.error}`,
          },
        ],
      };
    }

    const invoices = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${invoices?.length || 0} repeating invoices:`,
        },
        ...(invoices?.map((invoice) => ({
          type: "text" as const,
          text: [
            `Repeating Invoice ID: ${invoice.repeatingInvoiceID}`,
            `Type: ${invoice.type || "Unknown"}`,
            `Status: ${invoice.status || "Unknown"}`,
            invoice.contact
              ? `Contact: ${invoice.contact.name} (${invoice.contact.contactID})`
              : null,
            invoice.reference ? `Reference: ${invoice.reference}` : null,
            invoice.schedule
              ? `Schedule: Every ${invoice.schedule.period} ${invoice.schedule.unit}`
              : null,
            invoice.schedule?.startDate
              ? `Start Date: ${invoice.schedule.startDate}`
              : null,
            invoice.schedule?.nextScheduledDate
              ? `Next Scheduled: ${invoice.schedule.nextScheduledDate}`
              : null,
            invoice.schedule?.endDate
              ? `End Date: ${invoice.schedule.endDate}`
              : null,
            invoice.lineAmountTypes
              ? `Line Amount Types: ${invoice.lineAmountTypes}`
              : null,
            invoice.subTotal !== undefined
              ? `Sub Total: ${invoice.subTotal}`
              : null,
            invoice.totalTax !== undefined
              ? `Total Tax: ${invoice.totalTax}`
              : null,
            invoice.total !== undefined ? `Total: ${invoice.total}` : null,
            invoice.currencyCode
              ? `Currency: ${invoice.currencyCode}`
              : null,
            invoice.lineItems && invoice.lineItems.length > 0
              ? `Line Items: ${invoice.lineItems.map(formatLineItem).join("; ")}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
);

export default ListRepeatingInvoicesTool;
