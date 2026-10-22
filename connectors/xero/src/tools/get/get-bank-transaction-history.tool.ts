import { z } from "zod";
import { getXeroBankTransactionHistory } from "../../handlers/get-xero-bank-transaction-history.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetBankTransactionHistoryTool = CreateXeroTool(
  "get_bank_transaction_history",
  "Get the history and notes for a specific bank transaction in Xero. \
  Returns a list of history records showing changes, user actions, and notes.",
  {
    bankTransactionId: z
      .string()
      .describe(
        "The ID of the bank transaction to retrieve history for. Can be obtained from list_bank_transactions.",
      ),
  },
  async ({ bankTransactionId }) => {
    const response = await getXeroBankTransactionHistory(bankTransactionId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting bank transaction history: ${response.error}`,
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
            `Bank transaction history (${records.length} record${records.length === 1 ? "" : "s"}):`,
            ...recordLines,
          ].join("\n"),
        },
      ],
    };
  },
);

export default GetBankTransactionHistoryTool;
