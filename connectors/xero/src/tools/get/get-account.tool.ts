import { z } from "zod";
import { getXeroAccount } from "../../handlers/get-xero-account.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetAccountTool = CreateXeroTool(
  "get_account",
  "Get a specific account by ID from Xero. \
  Use this to see full details including type, tax type, and bank account info.",
  {
    accountId: z
      .string()
      .describe(
        "The ID of the account to retrieve. Can be obtained from list_accounts.",
      ),
  },
  async ({ accountId }) => {
    const response = await getXeroAccount(accountId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting account: ${response.error}`,
          },
        ],
      };
    }

    const a = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Account details:",
            `Account ID: ${a.accountID}`,
            a.name ? `Name: ${a.name}` : null,
            a.code ? `Code: ${a.code}` : null,
            a.type ? `Type: ${a.type}` : null,
            a.status ? `Status: ${a.status}` : null,
            a.taxType ? `Tax Type: ${a.taxType}` : null,
            a._class ? `Class: ${a._class}` : null,
            a.bankAccountNumber
              ? `Bank Account Number: ${a.bankAccountNumber}`
              : null,
            a.bankAccountType
              ? `Bank Account Type: ${a.bankAccountType}`
              : null,
            a.currencyCode ? `Currency: ${a.currencyCode}` : null,
            a.description ? `Description: ${a.description}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default GetAccountTool;
