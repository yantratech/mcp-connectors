import { createXeroAccount } from "../../handlers/create-xero-account.handler.js";
import { z } from "zod";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const CreateAccountTool = CreateXeroTool(
  "create_account",
  "Create a new account in Xero's chart of accounts. Requires a name, code, and account type.",
  {
    name: z.string().describe("Name of the account"),
    code: z.string().describe("A unique code for the account (e.g. 200, 400)"),
    type: z.enum([
      "BANK",
      "CURRENT",
      "CURRLIAB",
      "DEPRECIATN",
      "DIRECTCOSTS",
      "EQUITY",
      "EXPENSE",
      "FIXED",
      "INVENTORY",
      "LIABILITY",
      "NONCURRENT",
      "OTHERINCOME",
      "OVERHEADS",
      "PREPAYMENT",
      "REVENUE",
      "SALES",
      "TERMLIAB",
      "PAYGLIABILITY",
      "SUPERANNUATIONEXPENSE",
      "SUPERANNUATIONLIABILITY",
      "WAGESEXPENSE",
      "WAGESPAYABLELIABILITY",
    ]).describe("The account type"),
    taxType: z.string().optional().describe("The tax type code for the account"),
    description: z.string().optional().describe("Description of the account"),
    bankAccountNumber: z.string().optional().describe("Bank account number (required for BANK type accounts)"),
    enablePaymentsToAccount: z.boolean().optional().describe("Enable payments to this account"),
  },
  async ({
    name,
    code,
    type,
    taxType,
    description,
    bankAccountNumber,
    enablePaymentsToAccount,
  }: {
    name: string;
    code: string;
    type: string;
    taxType?: string;
    description?: string;
    bankAccountNumber?: string;
    enablePaymentsToAccount?: boolean;
  }) => {
    const response = await createXeroAccount(
      name,
      code,
      type,
      taxType,
      description,
      bankAccountNumber,
      enablePaymentsToAccount,
    );

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error creating account: ${response.error}`,
          },
        ],
      };
    }

    const account = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            `Account created: ${account.name} (ID: ${account.accountID})`,
            `Code: ${account.code}`,
            `Type: ${account.type}`,
            `Status: ${account.status || "Unknown"}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default CreateAccountTool;
