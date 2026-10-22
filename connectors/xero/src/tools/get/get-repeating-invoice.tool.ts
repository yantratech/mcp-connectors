import { z } from "zod";
import { getXeroRepeatingInvoice } from "../../handlers/get-xero-repeating-invoice.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { formatLineItem } from "../../helpers/format-line-item.js";

const GetRepeatingInvoiceTool = CreateXeroTool(
  "get_repeating_invoice",
  "Get a specific repeating invoice by ID from Xero. \
  Use this to see full details of a repeating invoice including line items and schedule.",
  {
    repeatingInvoiceId: z
      .string()
      .describe(
        "The ID of the repeating invoice to retrieve. Can be obtained from list_repeating_invoices.",
      ),
  },
  async ({ repeatingInvoiceId }) => {
    const response = await getXeroRepeatingInvoice(repeatingInvoiceId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting repeating invoice: ${response.error}`,
          },
        ],
      };
    }

    const invoice = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Repeating invoice details:",
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
              ? `Line Items:\n${invoice.lineItems.map(formatLineItem).join("\n")}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default GetRepeatingInvoiceTool;
