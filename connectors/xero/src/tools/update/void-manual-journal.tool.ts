import { z } from "zod";
import { voidXeroManualJournal } from "../../handlers/void-xero-manual-journal.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const VoidManualJournalTool = CreateXeroTool(
  "void_manual_journal",
  "Void a manual journal in Xero. Only POSTED manual journals can be voided. \
  Voiding is permanent and cannot be undone. \
  Always confirm with the user before voiding.",
  {
    manualJournalId: z
      .string()
      .describe(
        "The ID of the manual journal to void. Can be obtained from the list_manual_journals tool.",
      ),
  },
  async ({ manualJournalId }) => {
    const result = await voidXeroManualJournal(manualJournalId);

    if (result.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error voiding manual journal: ${result.error}`,
          },
        ],
      };
    }

    const journal = result.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Manual journal voided successfully:",
            `Journal ID: ${journal.manualJournalID}`,
            `Narration: ${journal.narration}`,
            `Status: ${journal.status}`,
            journal.date ? `Date: ${journal.date}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default VoidManualJournalTool;
