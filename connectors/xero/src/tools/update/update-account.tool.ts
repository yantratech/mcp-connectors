import { updateXeroAccount } from "../../handlers/update-xero-account.handler.js";
import { z } from "zod";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const UpdateAccountTool = CreateXeroTool(
  "update_account",
  "Update an existing account in Xero's chart of accounts.",
  {
    accountID: z.string().describe("The Xero identifier for the account"),
    name: z.string().optional().describe("Name of the account"),
    code: z.string().optional().describe("A unique code for the account"),
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
    ]).optional().describe("The account type"),
    taxType: z.string().optional().describe("The tax type code for the account"),
    description: z.string().optional().describe("Description of the account"),
    enablePaymentsToAccount: z.boolean().optional().describe("Enable payments to this account"),
  },
  async ({
    accountID,
    name,
    code,
    type,
    taxType,
    description,
    enablePaymentsToAccount,
  }: {
    accountID: string;
    name?: string;
    code?: string;
    type?: string;
    taxType?: string;
    description?: string;
    enablePaymentsToAccount?: boolean;
  }) => {
    const response = await updateXeroAccount(
      accountID,
      name,
      code,
      type,
      taxType,
      description,
      enablePaymentsToAccount,
    );

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error updating account: ${response.error}`,
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
            `Account updated: ${account.name} (ID: ${account.accountID})`,
            account.code ? `Code: ${account.code}` : null,
            account.type ? `Type: ${account.type}` : null,
            `Status: ${account.status || "Unknown"}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default UpdateAccountTool;
