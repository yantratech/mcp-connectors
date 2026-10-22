import { z } from "zod";
import { getXeroManualJournal } from "../../handlers/get-xero-manual-journal.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import {
  formatManualJournalLineDrCr,
  formatManualJournalLineTrackingRow,
} from "../../helpers/format-manual-journal-line.js";

const GetManualJournalTool = CreateXeroTool(
  "get_manual_journal",
  "Get a specific manual journal by ID from Xero. \
  Use this to see full details including journal lines. \
  Line amounts follow Xero's sign convention — positive = debit, negative = credit — \
  and each line is rendered with an explicit Dr:/Cr: split.",
  {
    manualJournalId: z
      .string()
      .describe(
        "The ID of the manual journal to retrieve. Can be obtained from list_manual_journals.",
      ),
  },
  async ({ manualJournalId }) => {
    const response = await getXeroManualJournal(manualJournalId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting manual journal: ${response.error}`,
          },
        ],
      };
    }

    const mj = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Manual journal details:",
            `Manual Journal ID: ${mj.manualJournalID}`,
            mj.narration ? `Narration: ${mj.narration}` : null,
            mj.date ? `Date: ${mj.date}` : null,
            mj.status ? `Status: ${mj.status}` : null,
            mj.lineAmountTypes
              ? `Line Amount Types: ${mj.lineAmountTypes}`
              : null,
            mj.journalLines && mj.journalLines.length > 0
              ? `Journal Lines (positive = debit, negative = credit):\n${mj.journalLines.map((jl) => `  Account: ${jl.accountCode}, Description: ${jl.description || "N/A"}, Amount: ${jl.lineAmount} (${formatManualJournalLineDrCr(jl)}), Tax Type: ${jl.taxType || "N/A"}${formatManualJournalLineTrackingRow(jl, ", Tracking: ") ?? ""}`).join("\n")}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default GetManualJournalTool;
