import { z } from "zod";
import { createXeroInvoiceHistoryNote } from "../../handlers/create-xero-invoice-history-note.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const CreateInvoiceHistoryNoteTool = CreateXeroTool(
  "create_invoice_history_note",
  "Add a note to the history of a specific invoice in Xero. \
  Use this to annotate invoices with additional context or comments.",
  {
    invoiceId: z
      .string()
      .describe(
        "The ID of the invoice to add a history note to. Can be obtained from list_invoices or get_invoice.",
      ),
    details: z
      .string()
      .describe("The note text to add to the invoice history."),
  },
  async ({ invoiceId, details }) => {
    const response = await createXeroInvoiceHistoryNote(invoiceId, details);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error creating invoice history note: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Invoice history note created successfully.",
            `Details: ${response.result.details}`,
            response.result.dateUTC
              ? `Date: ${response.result.dateUTC}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default CreateInvoiceHistoryNoteTool;
