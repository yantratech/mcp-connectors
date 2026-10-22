import { z } from "zod";
import { createXeroReceipt } from "../../handlers/create-xero-receipt.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const lineItemSchema = z.object({
  description: z.string().describe("The description of the line item"),
  quantity: z.number().describe("The quantity"),
  unitAmount: z.number().describe("The price per unit"),
  accountCode: z
    .string()
    .describe("The account code - can be obtained from the list_accounts tool"),
  taxType: z
    .string()
    .describe("The tax type - can be obtained from the list_tax_rates tool"),
});

const CreateReceiptTool = CreateXeroTool(
  "create_receipt",
  "Create a receipt (expense claim) in Xero. Receipts represent expenses incurred \
  by a user that need to be claimed. The receipt will be created in DRAFT status. \
  You need a user ID — this is the Xero user who incurred the expense.",
  {
    contactId: z
      .string()
      .describe(
        "The ID of the supplier contact. Can be obtained from list_contacts.",
      ),
    userId: z
      .string()
      .describe(
        "The ID of the Xero user who incurred the expense.",
      ),
    lineItems: z.array(lineItemSchema),
    date: z
      .string()
      .describe("The date of the receipt (YYYY-MM-DD format).")
      .optional(),
    reference: z
      .string()
      .describe("A reference for the receipt.")
      .optional(),
  },
  async ({ contactId, userId, lineItems, date, reference }) => {
    const result = await createXeroReceipt(
      contactId,
      userId,
      lineItems,
      date,
      reference,
    );

    if (result.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error creating receipt: ${result.error}`,
          },
        ],
      };
    }

    const receipt = result.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Receipt created successfully:",
            `Receipt ID: ${receipt.receiptID}`,
            receipt.receiptNumber ? `Number: ${receipt.receiptNumber}` : null,
            `Status: ${receipt.status}`,
            receipt.contact ? `Contact: ${receipt.contact.name}` : null,
            receipt.total !== undefined ? `Total: ${receipt.total}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default CreateReceiptTool;
