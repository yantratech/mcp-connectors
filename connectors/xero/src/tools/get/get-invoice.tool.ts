import { z } from "zod";
import { getXeroInvoice } from "../../handlers/get-xero-invoice.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { formatLineItem } from "../../helpers/format-line-item.js";

const GetInvoiceTool = CreateXeroTool(
  "get_invoice",
  "Get a specific invoice by ID from Xero. \
  Use this to see full details including line items, amounts, and payment status.",
  {
    invoiceId: z
      .string()
      .describe(
        "The ID of the invoice to retrieve. Can be obtained from list_invoices.",
      ),
  },
  async ({ invoiceId }) => {
    const response = await getXeroInvoice(invoiceId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting invoice: ${response.error}`,
          },
        ],
      };
    }

    const inv = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Invoice details:",
            `Invoice ID: ${inv.invoiceID}`,
            inv.invoiceNumber ? `Invoice Number: ${inv.invoiceNumber}` : null,
            inv.type ? `Type: ${inv.type}` : null,
            inv.status ? `Status: ${inv.status}` : null,
            inv.contact ? `Contact: ${inv.contact.name}` : null,
            inv.date ? `Date: ${inv.date}` : null,
            inv.dueDate ? `Due Date: ${inv.dueDate}` : null,
            inv.total !== undefined ? `Total: ${inv.total}` : null,
            inv.amountDue !== undefined ? `Amount Due: ${inv.amountDue}` : null,
            inv.amountPaid !== undefined
              ? `Amount Paid: ${inv.amountPaid}`
              : null,
            inv.reference ? `Reference: ${inv.reference}` : null,
            inv.currencyCode ? `Currency: ${inv.currencyCode}` : null,
            inv.lineItems && inv.lineItems.length > 0
              ? `Line Items (${inv.lineItems.length}):\n${inv.lineItems
                  .map(formatLineItem)
                  .join("\n")}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default GetInvoiceTool;
