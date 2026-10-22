import { z } from "zod";
import { listXeroPurchaseOrders } from "../../handlers/list-xero-purchase-orders.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListPurchaseOrdersTool = CreateXeroTool(
  "list_purchase_orders",
  "List purchase orders in Xero. Purchase orders are documents sent to suppliers \
  to order goods or services. \
  Ask the user if they want the next page if 10 results are returned.",
  {
    page: z.number().optional().describe("The page number to retrieve, starting from 1. Defaults to 1."),
    status: z
      .enum(["DRAFT", "SUBMITTED", "AUTHORISED", "BILLED", "DELETED"])
      .optional()
      .describe("Filter by purchase order status."),
    dateFrom: z
      .string()
      .optional()
      .describe("Filter by date from (YYYY-MM-DD format)."),
    dateTo: z
      .string()
      .optional()
      .describe("Filter by date to (YYYY-MM-DD format)."),
  },
  async ({ page, status, dateFrom, dateTo }) => {
    const response = await listXeroPurchaseOrders(
      page ?? 1,
      status,
      dateFrom,
      dateTo,
    );

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing purchase orders: ${response.error}`,
          },
        ],
      };
    }

    const orders = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${orders?.length || 0} purchase orders:`,
        },
        ...(orders?.map((po) => ({
          type: "text" as const,
          text: [
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
            po.updatedDateUTC
              ? `Last Updated: ${po.updatedDateUTC}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
);

export default ListPurchaseOrdersTool;
