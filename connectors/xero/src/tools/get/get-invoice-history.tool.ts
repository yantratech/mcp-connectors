import { z } from "zod";
import { getXeroInvoiceHistory } from "../../handlers/get-xero-invoice-history.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetInvoiceHistoryTool = CreateXeroTool(
  "get_invoice_history",
  "Get the history and notes for a specific invoice in Xero. \
  Returns a list of history records showing changes, user actions, and notes.",
  {
    invoiceId: z
      .string()
      .describe(
        "The ID of the invoice to retrieve history for. Can be obtained from list_invoices or get_invoice.",
      ),
  },
  async ({ invoiceId }) => {
    const response = await getXeroInvoiceHistory(invoiceId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting invoice history: ${response.error}`,
          },
        ],
      };
    }

    const records = response.result;

    const recordLines = records.map((record) =>
      [
        record.dateUTC ? `Date: ${record.dateUTC}` : null,
        record.user ? `User: ${record.user}` : null,
        record.details ? `Details: ${record.details}` : null,
        record.changes ? `Changes: ${record.changes}` : null,
        "---",
      ]
        .filter(Boolean)
        .join("\n"),
    );

    return {
      content: [
        {
          type: "text" as const,
          text: [
            `Invoice history (${records.length} record${records.length === 1 ? "" : "s"}):`,
            ...recordLines,
          ].join("\n"),
        },
      ],
    };
  },
);

export default GetInvoiceHistoryTool;
