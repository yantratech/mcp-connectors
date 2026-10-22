import { z } from "zod";
import { getXeroHistory } from "../../handlers/get-xero-history.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetHistoryTool = CreateXeroTool(
  "get_history",
  "Get the history and notes for a Xero entity by type and ID. \
  Returns a list of history records showing changes, user actions, and notes. \
  Covers credit notes, payments, purchase orders, quotes, items, manual journals, \
  bank transfers, prepayments, overpayments, receipts, and repeating invoices. \
  For invoices, contacts, and bank transactions use the dedicated \
  get_invoice_history, get_contact_history, and get_bank_transaction_history tools instead.",
  {
    entityType: z
      .enum([
        "creditNotes",
        "payments",
        "purchaseOrders",
        "quotes",
        "items",
        "manualJournals",
        "bankTransfers",
        "prepayments",
        "overpayments",
        "receipts",
        "repeatingInvoices",
      ])
      .describe("The type of entity to retrieve history for. The receipts type requires XERO_ENABLE_RECEIPTS=1."),
    entityId: z
      .string()
      .describe(
        "The ID of the entity (e.g. credit note ID, payment ID). Can be obtained from the corresponding list tool.",
      ),
  },
  async ({ entityType, entityId }) => {
    const response = await getXeroHistory(entityType, entityId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting history: ${response.error}`,
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
            `History for ${entityType} ${entityId} (${records.length} record${records.length === 1 ? "" : "s"}):`,
            ...recordLines,
          ].join("\n"),
        },
      ],
    };
  },
);

export default GetHistoryTool;
