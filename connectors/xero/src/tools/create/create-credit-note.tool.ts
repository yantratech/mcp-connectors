import { z } from "zod";
import { createXeroCreditNote } from "../../handlers/create-xero-credit-note.handler.js";
import { DeepLinkType, getDeepLink } from "../../helpers/get-deeplink.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const lineItemSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  unitAmount: z.number(),
  accountCode: z.string(),
  taxType: z.string(),
});

const CreateCreditNoteTool = CreateXeroTool(
  "create_credit_note",
  "Create a credit note in Xero.\
 When a credit note is created, a deep link to the credit note in Xero is returned. \
 This deep link can be used to view the credit note in Xero directly. \
 This link should be displayed to the user.",
  {
    contactId: z.string(),
    lineItems: z.array(lineItemSchema),
    reference: z.string().optional(),
    currencyCode: z.string().describe("ISO 4217 currency code (e.g. USD, GBP, EUR). Defaults to the contact's currency if omitted.").optional(),
    creditNoteNumber: z
      .string()
      .trim()
      .min(1, "creditNoteNumber cannot be empty")
      .optional()
      .describe(
        "Custom credit-note number (e.g. 'CN-ACME-001'). \
If omitted, Xero auto-assigns the next number from the org's sequence. \
Xero will reject duplicates with its own error.",
      ),
  },
  async ({ contactId, lineItems, reference, currencyCode, creditNoteNumber }) => {
    const result = await createXeroCreditNote(
      contactId,
      lineItems,
      reference,
      currencyCode,
      creditNoteNumber,
    );
    if (result.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error creating credit note: ${result.error}`,
          },
        ],
      };
    }

    const creditNote = result.result;

    const deepLink = creditNote.creditNoteID
      ? await getDeepLink(DeepLinkType.CREDIT_NOTE, creditNote.creditNoteID)
      : null;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Credit note created successfully:",
            `ID: ${creditNote?.creditNoteID}`,
            creditNote?.creditNoteNumber
              ? `Credit Note Number: ${creditNote.creditNoteNumber}`
              : null,
            `Contact: ${creditNote?.contact?.name}`,
            `Total: ${creditNote?.total}`,
            `Status: ${creditNote?.status}`,
            deepLink ? `Link to view: ${deepLink}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default CreateCreditNoteTool;
