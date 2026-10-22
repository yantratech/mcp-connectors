import { z } from "zod";
import { getXeroCreditNote } from "../../handlers/get-xero-credit-note.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetCreditNoteTool = CreateXeroTool(
  "get_credit_note",
  "Get a specific credit note by ID from Xero. \
  Use this to see full details including contact, amounts, and remaining credit.",
  {
    creditNoteId: z
      .string()
      .describe(
        "The ID of the credit note to retrieve. Can be obtained from list_credit_notes.",
      ),
  },
  async ({ creditNoteId }) => {
    const response = await getXeroCreditNote(creditNoteId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting credit note: ${response.error}`,
          },
        ],
      };
    }

    const cn = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Credit note details:",
            `Credit Note ID: ${cn.creditNoteID}`,
            cn.creditNoteNumber
              ? `Credit Note Number: ${cn.creditNoteNumber}`
              : null,
            cn.type ? `Type: ${cn.type}` : null,
            cn.status ? `Status: ${cn.status}` : null,
            cn.contact ? `Contact: ${cn.contact.name}` : null,
            cn.date ? `Date: ${cn.date}` : null,
            cn.total !== undefined ? `Total: ${cn.total}` : null,
            cn.remainingCredit !== undefined
              ? `Remaining Credit: ${cn.remainingCredit}`
              : null,
            cn.reference ? `Reference: ${cn.reference}` : null,
            cn.currencyCode ? `Currency: ${cn.currencyCode}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default GetCreditNoteTool;
