import { z } from "zod";
import { getXeroItem } from "../../handlers/get-xero-item.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetItemTool = CreateXeroTool(
  "get_item",
  "Get a specific item by ID from Xero. \
  Use this to see full details including purchase and sales details.",
  {
    itemId: z
      .string()
      .describe(
        "The ID of the item to retrieve. Can be obtained from list_items.",
      ),
  },
  async ({ itemId }) => {
    const response = await getXeroItem(itemId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting item: ${response.error}`,
          },
        ],
      };
    }

    const item = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Item details:",
            `Item ID: ${item.itemID}`,
            item.code ? `Code: ${item.code}` : null,
            item.name ? `Name: ${item.name}` : null,
            item.description ? `Description: ${item.description}` : null,
            item.purchaseDescription
              ? `Purchase Description: ${item.purchaseDescription}`
              : null,
            item.purchaseDetails
              ? `Purchase Details: Unit Price: ${item.purchaseDetails.unitPrice}, Account Code: ${item.purchaseDetails.accountCode}, Tax Type: ${item.purchaseDetails.taxType}`
              : null,
            item.salesDetails
              ? `Sales Details: Unit Price: ${item.salesDetails.unitPrice}, Account Code: ${item.salesDetails.accountCode}, Tax Type: ${item.salesDetails.taxType}`
              : null,
            item.isSold !== undefined ? `Is Sold: ${item.isSold}` : null,
            item.isPurchased !== undefined
              ? `Is Purchased: ${item.isPurchased}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default GetItemTool;
