import { z } from "zod";
import { getXeroContactHistory } from "../../handlers/get-xero-contact-history.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetContactHistoryTool = CreateXeroTool(
  "get_contact_history",
  "Get the history and notes for a specific contact in Xero. \
  Returns a list of history records showing changes, user actions, and notes.",
  {
    contactId: z
      .string()
      .describe(
        "The ID of the contact to retrieve history for. Can be obtained from list_contacts or get_contact.",
      ),
  },
  async ({ contactId }) => {
    const response = await getXeroContactHistory(contactId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting contact history: ${response.error}`,
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
            `Contact history (${records.length} record${records.length === 1 ? "" : "s"}):`,
            ...recordLines,
          ].join("\n"),
        },
      ],
    };
  },
);

export default GetContactHistoryTool;
