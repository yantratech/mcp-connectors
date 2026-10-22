import { z } from "zod";
import { getXeroBankTransfer } from "../../handlers/get-xero-bank-transfer.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetBankTransferTool = CreateXeroTool(
  "get_bank_transfer",
  "Get a specific bank transfer by ID from Xero. \
  Use this to see full details of a bank transfer including linked transactions.",
  {
    bankTransferId: z
      .string()
      .describe(
        "The ID of the bank transfer to retrieve. Can be obtained from list_bank_transfers.",
      ),
  },
  async ({ bankTransferId }) => {
    const response = await getXeroBankTransfer(bankTransferId);
    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting bank transfer: ${response.error}`,
          },
        ],
      };
    }

    const transfer = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Bank transfer details:",
            `Transfer ID: ${transfer.bankTransferID}`,
            transfer.fromBankAccount
              ? `From: ${transfer.fromBankAccount.name} (${transfer.fromBankAccount.accountID})`
              : null,
            transfer.toBankAccount
              ? `To: ${transfer.toBankAccount.name} (${transfer.toBankAccount.accountID})`
              : null,
            `Amount: ${transfer.amount}`,
            transfer.date ? `Date: ${transfer.date}` : null,
            transfer.reference ? `Reference: ${transfer.reference}` : null,
            transfer.currencyRate
              ? `Currency Rate: ${transfer.currencyRate}`
              : null,
            transfer.fromBankTransactionID
              ? `From Transaction ID: ${transfer.fromBankTransactionID}`
              : null,
            transfer.toBankTransactionID
              ? `To Transaction ID: ${transfer.toBankTransactionID}`
              : null,
            transfer.createdDateUTC
              ? `Created: ${transfer.createdDateUTC}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default GetBankTransferTool;
