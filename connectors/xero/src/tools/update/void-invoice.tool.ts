import { z } from "zod";
import { voidXeroInvoice } from "../../handlers/void-xero-invoice.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const VoidInvoiceTool = CreateXeroTool(
  "void_invoice",
  "Void an invoice in Xero. Only AUTHORISED invoices can be voided. \
  Voiding is permanent and cannot be undone. \
  Draft invoices should be deleted instead. \
  Paid invoices cannot be voided until the payment is removed. \
  Always confirm with the user before voiding.",
  {
    invoiceId: z
      .string()
      .describe(
        "The ID of the invoice to void. Can be obtained from the list_invoices tool.",
      ),
  },
  async ({ invoiceId }) => {
    const result = await voidXeroInvoice(invoiceId);

    if (result.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error voiding invoice: ${result.error}`,
          },
        ],
      };
    }

    const invoice = result.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Invoice voided successfully:",
            `Invoice ID: ${invoice.invoiceID}`,
            `Invoice Number: ${invoice.invoiceNumber}`,
            `Status: ${invoice.status}`,
            invoice.contact ? `Contact: ${invoice.contact.name}` : null,
            invoice.total !== undefined ? `Total: ${invoice.total}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default VoidInvoiceTool;
