import { z } from "zod";
import { createXeroBankTransfer } from "../../handlers/create-xero-bank-transfer.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const CreateBankTransferTool = CreateXeroTool(
  "create_bank_transfer",
  "Create a bank transfer in Xero: it records a transfer between two of the organisation's bank accounts in the ledger (it does not instruct any bank to move money). \
  Both the source and destination must be bank accounts (not regular accounts). \
  Use the list_accounts tool to find bank account IDs.",
  {
    fromBankAccountId: z
      .string()
      .describe(
        "The ID of the bank account to transfer from. Can be obtained from list_accounts.",
      ),
    toBankAccountId: z
      .string()
      .describe(
        "The ID of the bank account to transfer to. Can be obtained from list_accounts.",
      ),
    amount: z.number().describe("The amount to transfer."),
    date: z
      .string()
      .describe("The date of the transfer (YYYY-MM-DD format).")
      .optional(),
    reference: z
      .string()
      .describe("An optional reference for the transfer.")
      .optional(),
  },
  async ({ fromBankAccountId, toBankAccountId, amount, date, reference }) => {
    const result = await createXeroBankTransfer(
      fromBankAccountId,
      toBankAccountId,
      amount,
      date,
      reference,
    );

    if (result.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error creating bank transfer: ${result.error}`,
          },
        ],
      };
    }

    const transfer = result.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Bank transfer created successfully:",
            `Transfer ID: ${transfer.bankTransferID}`,
            transfer.fromBankAccount
              ? `From: ${transfer.fromBankAccount.name}`
              : null,
            transfer.toBankAccount
              ? `To: ${transfer.toBankAccount.name}`
              : null,
            `Amount: ${transfer.amount}`,
            transfer.date ? `Date: ${transfer.date}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default CreateBankTransferTool;
