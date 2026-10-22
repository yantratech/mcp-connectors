import { z } from "zod";
import { getXeroJournal } from "../../handlers/get-xero-journal.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetJournalTool = CreateXeroTool(
  "get_journal",
  "Get a specific system journal by ID from Xero (read-only). \
  System journals are auto-generated for all transactions. \
  Use this to see full details including all journal lines.",
  {
    journalId: z
      .string()
      .describe(
        "The ID of the journal to retrieve. Can be obtained from list_journals.",
      ),
  },
  async ({ journalId }) => {
    const response = await getXeroJournal(journalId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting journal: ${response.error}`,
          },
        ],
      };
    }

    const j = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Journal details:",
            `Journal ID: ${j.journalID}`,
            j.journalNumber !== undefined
              ? `Journal Number: ${j.journalNumber}`
              : null,
            j.journalDate ? `Date: ${j.journalDate}` : null,
            j.reference ? `Reference: ${j.reference}` : null,
            j.sourceID ? `Source ID: ${j.sourceID}` : null,
            j.sourceType ? `Source Type: ${j.sourceType}` : null,
            j.createdDateUTC ? `Created: ${j.createdDateUTC}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
        ...(j.journalLines?.map((line) => ({
          type: "text" as const,
          text: [
            `  Account: ${line.accountCode} - ${line.accountName}`,
            `  Description: ${line.description || "N/A"}`,
            `  Gross Amount: ${line.grossAmount}`,
            `  Net Amount: ${line.netAmount}`,
            `  Tax Amount: ${line.taxAmount}`,
            line.taxType ? `  Tax Type: ${line.taxType}` : null,
            line.trackingCategories && line.trackingCategories.length > 0
              ? `  Tracking: ${line.trackingCategories.map((tc) => `${tc.name}: ${tc.option}`).join(", ")}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
);

export default GetJournalTool;
