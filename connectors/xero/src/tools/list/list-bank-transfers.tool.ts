import { listXeroBankTransfers } from "../../handlers/list-xero-bank-transfers.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListBankTransfersTool = CreateXeroTool(
  "list_bank_transfers",
  "List bank transfers in Xero. Bank transfers record money moved between bank accounts \
  (different from bank transactions which are spend/receive money). \
  Ask the user if they want the next page of transfers after running this tool \
  if 10 transfers are returned.",
  {},
  async () => {
    const response = await listXeroBankTransfers();
    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing bank transfers: ${response.error}`,
          },
        ],
      };
    }

    const transfers = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${transfers?.length || 0} bank transfers:`,
        },
        ...(transfers?.map((transfer) => ({
          type: "text" as const,
          text: [
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
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
);

export default ListBankTransfersTool;
