import { z } from "zod";
import { listXeroJournals } from "../../handlers/list-xero-journals.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { Journal, JournalLine } from "xero-node";

export function formatJournalLine(l: JournalLine): string {
  const net = l.netAmount ?? 0;
  const account =
    [l.accountCode, l.accountName].filter(Boolean).join(" ") ||
    l.accountID ||
    "(no account)";
  // Dr/Cr from netAmount (tax-exclusive), which always balances across a
  // journal. grossAmount = net + tax, so rendering gross would double-count
  // tax against the separate tax-control line.
  const drCr = `Dr:${net > 0 ? net : 0} Cr:${net < 0 ? Math.abs(net) : 0}`;
  const tax = l.taxAmount
    ? ` Tax:${l.taxAmount}${l.taxName ? ` (${l.taxName})` : ""} Gross:${l.grossAmount}`
    : "";
  return `${account} ${l.description || ""} ${drCr}${tax}`;
}

export function formatJournal(j: Journal): string {
  return [
    `Journal ID: ${j.journalID}`,
    j.journalNumber !== undefined ? `Journal Number: ${j.journalNumber}` : null,
    j.journalDate ? `Date: ${j.journalDate}` : null,
    j.reference ? `Reference: ${j.reference}` : null,
    j.sourceID ? `Source ID: ${j.sourceID}` : null,
    j.sourceType ? `Source Type: ${j.sourceType}` : null,
    j.journalLines && j.journalLines.length > 0
      ? `Lines (net of tax): ${j.journalLines.map(formatJournalLine).join(" | ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

const ListJournalsTool = CreateXeroTool(
  "list_journals",
  "List system journals in Xero (read-only) — the auto-generated double-entry records \
  behind every transaction; different from user-created manual journals. \
  ORDERING: journals are returned OLDEST FIRST by journal number, max 100 per call, \
  so a default call returns the very first journals ever recorded, NOT recent activity. \
  To reach recent entries, keep calling with offset set to the highest journal number \
  returned so far until fewer than 100 come back. \
  Line amounts are rendered NET of tax (Dr/Cr from netAmount, which always balances); \
  tax is shown separately per line — do not add tax amounts again when totalling.",
  {
    offset: z
      .number()
      .optional()
      .describe(
        "Return journals with journal number GREATER THAN this value. Use the last journal number from a previous call to paginate forward (towards recent entries).",
      ),
    paymentsOnly: z
      .boolean()
      .optional()
      .describe("If true, only return journals on a cash basis (payments)."),
  },
  async ({ offset, paymentsOnly }) => {
    const response = await listXeroJournals(offset, paymentsOnly);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing journals: ${response.error}`,
          },
        ],
      };
    }

    const journals = response.result ?? [];
    const firstNumber = journals[0]?.journalNumber;
    const lastNumber = journals[journals.length - 1]?.journalNumber;

    let header: string;
    if (journals.length === 0) {
      header = `Found 0 journals${offset !== undefined ? ` with journal number above ${offset}` : ""}.`;
    } else {
      const capNote =
        journals.length === 100
          ? `100-per-call cap reached — MORE journals exist; call again with offset=${lastNumber}`
          : "end of the journal list reached";
      header = `Found ${journals.length} journals (journal numbers ${firstNumber}-${lastNumber}, OLDEST first; ${capNote}). Line amounts are net of tax; tax is shown separately per line.`;
    }

    return {
      content: [
        {
          type: "text" as const,
          text: header,
        },
        ...journals.map((j) => ({
          type: "text" as const,
          text: formatJournal(j),
        })),
      ],
    };
  },
);

export default ListJournalsTool;
