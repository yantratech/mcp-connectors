import { z } from "zod";
import { updateXeroPurchaseOrder } from "../../handlers/update-xero-purchase-order.handler.js";
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
      "The tax type of the line item - can be obtained from the list_tax_rates tool",
    ),
  itemCode: z
    .string()
    .describe("The item code - can be obtained from the list_items tool")
    .optional(),
});

const UpdatePurchaseOrderTool = CreateXeroTool(
  "update_purchase_order",
  "Update an existing purchase order in Xero. \
  Can update line items, dates, reference, and status.",
  {
    purchaseOrderId: z
      .string()
      .describe(
        "The ID of the purchase order to update. Can be obtained from list_purchase_orders.",
      ),
    lineItems: z
      .array(lineItemSchema)
      .optional()
      .describe("Updated line items. Replaces all existing line items."),
    date: z
      .string()
      .describe("The date (YYYY-MM-DD format).")
      .optional(),
    deliveryDate: z
      .string()
      .describe("The expected delivery date (YYYY-MM-DD format).")
      .optional(),
    reference: z
      .string()
      .describe("A reference for the purchase order.")
      .optional(),
    status: z
      .enum(["DRAFT", "SUBMITTED", "AUTHORISED", "DELETED"])
      .describe("The new status for the purchase order.")
      .optional(),
  },
  async ({
    purchaseOrderId,
    lineItems,
    date,
    deliveryDate,
    reference,
    status,
  }) => {
    const result = await updateXeroPurchaseOrder(
      purchaseOrderId,
      lineItems,
      date,
      deliveryDate,
      reference,
      status,
    );

    if (result.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error updating purchase order: ${result.error}`,
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
            "Purchase order updated successfully:",
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
  // Xero replaces line items on PUT — any line omitted from the payload is
  // dropped. Description already calls this out.
  { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
);

export default UpdatePurchaseOrderTool;
