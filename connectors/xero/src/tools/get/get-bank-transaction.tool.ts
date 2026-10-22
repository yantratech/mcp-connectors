import { z } from "zod";
import { getXeroBankTransaction } from "../../handlers/get-xero-bank-transaction.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetBankTransactionTool = CreateXeroTool(
  "get_bank_transaction",
  "Get a specific bank transaction by ID from Xero. \
  Use this to see full details including line items and reconciliation status.",
  {
    bankTransactionId: z
      .string()
      .describe(
        "The ID of the bank transaction to retrieve. Can be obtained from list_bank_transactions.",
      ),
  },
  async ({ bankTransactionId }) => {
    const response = await getXeroBankTransaction(bankTransactionId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting bank transaction: ${response.error}`,
          },
        ],
      };
    }

    const bt = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Bank transaction details:",
            `Bank Transaction ID: ${bt.bankTransactionID}`,
            bt.type ? `Type: ${bt.type}` : null,
            bt.status ? `Status: ${bt.status}` : null,
            bt.contact ? `Contact: ${bt.contact.name}` : null,
            bt.date ? `Date: ${bt.date}` : null,
            bt.total !== undefined ? `Total: ${bt.total}` : null,
            bt.reference ? `Reference: ${bt.reference}` : null,
            bt.bankAccount
              ? `Bank Account: ${bt.bankAccount.name} (${bt.bankAccount.accountID})`
              : null,
            bt.lineItems && bt.lineItems.length > 0
              ? `Line Items: ${bt.lineItems.length}`
              : null,
            bt.isReconciled !== undefined
              ? `Is Reconciled: ${bt.isReconciled}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default GetBankTransactionTool;
