import { archiveXeroAccount } from "../../handlers/archive-xero-account.handler.js";
import { z } from "zod";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ArchiveAccountTool = CreateXeroTool(
  "archive_account",
  "Archive (not delete) an account in Xero. This is reversible.",
  {
    accountID: z.string().describe("The Xero identifier for the account to archive"),
  },
  async (params: { accountID: string }) => {
    const { accountID } = params;
    const response = await archiveXeroAccount(accountID);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error archiving account: ${response.error}`,
          },
        ],
      };
    }

    const account = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Successfully archived account: ${account.name || "Unknown"} (Status: ${account.status})`,
        },
      ],
    };
  },
);

export default ArchiveAccountTool;
