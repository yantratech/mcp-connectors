import { z } from "zod";
import { getXeroPurchaseOrder } from "../../handlers/get-xero-purchase-order.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { formatLineItem } from "../../helpers/format-line-item.js";

const GetPurchaseOrderTool = CreateXeroTool(
  "get_purchase_order",
  "Get a specific purchase order by ID from Xero. \
  Use this to see full details including line items.",
  {
    purchaseOrderId: z
      .string()
      .describe(
        "The ID of the purchase order to retrieve. Can be obtained from list_purchase_orders.",
      ),
  },
  async ({ purchaseOrderId }) => {
    const response = await getXeroPurchaseOrder(purchaseOrderId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting purchase order: ${response.error}`,
          },
        ],
      };
    }

    const po = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Purchase order details:",
            `Purchase Order ID: ${po.purchaseOrderID}`,
            po.purchaseOrderNumber
              ? `Number: ${po.purchaseOrderNumber}`
              : null,
            po.status ? `Status: ${po.status}` : null,
            po.contact
              ? `Contact: ${po.contact?.name} (${po.contact?.contactID})`
              : null,
            po.date ? `Date: ${po.date}` : null,
            po.deliveryDate ? `Delivery Date: ${po.deliveryDate}` : null,
            po.reference ? `Reference: ${po.reference}` : null,
            po.subTotal !== undefined ? `Sub Total: ${po.subTotal}` : null,
            po.totalTax !== undefined ? `Total Tax: ${po.totalTax}` : null,
            po.total !== undefined ? `Total: ${po.total}` : null,
            po.currencyCode ? `Currency: ${po.currencyCode}` : null,
            po.lineItems && po.lineItems.length > 0
              ? `Line Items:\n${po.lineItems.map(formatLineItem).join("\n")}`
              : null,
            po.deliveryAddress ? `Delivery Address: ${po.deliveryAddress}` : null,
            po.deliveryInstructions
              ? `Delivery Instructions: ${po.deliveryInstructions}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default GetPurchaseOrderTool;
