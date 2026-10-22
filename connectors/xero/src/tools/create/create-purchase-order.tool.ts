import { z } from "zod";
import { createXeroPurchaseOrder } from "../../handlers/create-xero-purchase-order.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const lineItemSchema = z.object({
  description: z.string().describe("The description of the line item"),
  quantity: z.number().describe("The quantity of the line item"),
  unitAmount: z.number().describe("The price per unit of the line item"),
  accountCode: z
    .string()
    .describe(
      "The account code of the line item - can be obtained from the list_accounts tool",
    ),
  taxType: z
    .string()
    .describe(
      "The tax type of the line item - can be obtained from the list_tax_rates tool. If omitted, Xero uses the default for the account.",
    )
    .optional(),
  itemCode: z
    .string()
    .describe("The item code - can be obtained from the list_items tool")
    .optional(),
});

const CreatePurchaseOrderTool = CreateXeroTool(
  "create_purchase_order",
  "Create a purchase order in Xero. Purchase orders are documents sent to suppliers \
  to order goods or services. The PO will be created in DRAFT status.",
  {
    contactId: z
      .string()
      .describe(
        "The ID of the supplier contact. Can be obtained from the list_contacts tool.",
      ),
    lineItems: z.array(lineItemSchema),
    date: z
      .string()
      .describe("The date of the purchase order (YYYY-MM-DD format).")
      .optional(),
    deliveryDate: z
      .string()
      .describe("The expected delivery date (YYYY-MM-DD format).")
      .optional(),
    reference: z
      .string()
      .describe("A reference for the purchase order.")
      .optional(),
    currencyCode: z
      .string()
      .describe("ISO 4217 currency code (e.g. USD, GBP, EUR). Defaults to the contact's currency if omitted.")
      .optional(),
  },
  async ({ contactId, lineItems, date, deliveryDate, reference, currencyCode }) => {
    const result = await createXeroPurchaseOrder(
      contactId,
      lineItems,
      date,
      deliveryDate,
      reference,
      currencyCode,
    );

    if (result.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error creating purchase order: ${result.error}`,
          },
        ],
      };
    }

    const po = result.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Purchase order created successfully:",
            `ID: ${po.purchaseOrderID}`,
            po.purchaseOrderNumber ? `Number: ${po.purchaseOrderNumber}` : null,
            `Status: ${po.status}`,
            po.contact ? `Contact: ${po.contact.name}` : null,
            po.total !== undefined ? `Total: ${po.total}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default CreatePurchaseOrderTool;
