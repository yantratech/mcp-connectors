import { z } from "zod";
import { deleteXeroDraftInvoice } from "../../handlers/delete-xero-draft-invoice.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const DeleteDraftInvoiceTool = CreateXeroTool(
  "delete_draft_invoice",
  "Delete a draft invoice or bill in Xero. Only DRAFT invoices/bills can be deleted. \
  Authorised invoices should be voided instead using void_invoice. \
  Deletion is permanent and cannot be undone. \
  Always confirm with the user before deleting.",
  {
    invoiceId: z
      .string()
      .describe(
        "The ID of the draft invoice to delete. Can be obtained from the list_invoices tool.",
      ),
  },
  async ({ invoiceId }) => {
    const result = await deleteXeroDraftInvoice(invoiceId);

    if (result.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error deleting draft invoice: ${result.error}`,
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
            "Draft invoice deleted successfully:",
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

export default DeleteDraftInvoiceTool;
