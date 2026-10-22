import { z } from "zod";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { DeepLinkType, getDeepLink } from "../../helpers/get-deeplink.js";
import { ensureError } from "../../helpers/ensure-error.js";
import { manualJournalLineSchema } from "../../helpers/manual-journal-line-schema.js";
import { LineAmountTypes, ManualJournal } from "xero-node";
import { updateXeroManualJournal } from "../../handlers/update-xero-manual-journal.handler.js";

const UpdateManualJournalTool = CreateXeroTool(
  "update_manual_journal",
  "Update a manual journal in Xero. Only works on draft manual journals.\
  Do not modify line items or parameters that have not been specified by the user.\
  Journal lines are replaced wholesale: re-supply every existing line, including its \
  existing tracking (shown by get_manual_journal), unless the user asked to change or \
  remove it — a line sent without tracking loses any tracking it had.",
  {
    narration: z
      .string()
      .describe("Description of manual journal being posted"),
    manualJournalID: z.string().describe("ID of the manual journal to update"),
    manualJournalLines: z
      .array(manualJournalLineSchema)
      .describe(
        "The manualJournalLines element must contain at least two individual manualJournalLine sub-elements",
      ),
    date: z.string().optional().describe("Optional date in YYYY-MM-DD format"),
    lineAmountTypes: z
      .enum(["EXCLUSIVE", "INCLUSIVE", "NO_TAX"])
      .optional()
      .describe(
        "Optional line amount types (EXCLUSIVE, INCLUSIVE, NO_TAX), NO_TAX by default",
      ),
    status: z
      .enum(["DRAFT", "POSTED", "DELETED", "VOIDED", "ARCHIVED"])
      .optional()
      .describe(
        "Optional status of the manual journal (DRAFT, POSTED, DELETED, VOIDED, ARCHIVED), DRAFT by default",
      ),
    url: z
      .string()
      .optional()
      .describe("Optional URL link to a source document"),
    showOnCashBasisReports: z
      .boolean()
      .optional()
      .describe(
        "Optional boolean to show on cash basis reports, default is true",
      ),
  },
  async (args) => {
    try {
      const response = await updateXeroManualJournal(
        args.narration,
        args.manualJournalID,
        args.manualJournalLines,
        args.date,
        args.lineAmountTypes as LineAmountTypes | undefined,
        args.status as ManualJournal.StatusEnum | undefined,
        args.url,
        args.showOnCashBasisReports,
      );

      if (response.isError) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error updating manual journal: ${response.error}`,
            },
          ],
        };
      }

      const manualJournal = response.result;
      const deepLink = manualJournal.manualJournalID
        ? await getDeepLink(
            DeepLinkType.MANUAL_JOURNAL,
            manualJournal.manualJournalID,
          )
        : null;

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Manual journal updated: ${manualJournal.narration} (ID: ${manualJournal.manualJournalID})`,
              deepLink ? `Link to view: ${deepLink}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      };
    } catch (error) {
      const err = ensureError(error);

      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error updating manual journal: ${err.message}`,
          },
        ],
      };
    }
  },
  // Xero replaces journal lines on PUT — any line omitted from the payload
  // is dropped. The tool description warns the agent not to drop lines that
  // weren't explicitly being changed; the annotation flags destructive so
  // clients gate the call too.
  { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
);

export default UpdateManualJournalTool;
