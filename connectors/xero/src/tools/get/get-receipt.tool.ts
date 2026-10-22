import { z } from "zod";
import { getXeroReceipt } from "../../handlers/get-xero-receipt.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetReceiptTool = CreateXeroTool(
  "get_receipt",
  "Get a specific receipt (expense claim) by ID from Xero. \
  Use this to see full details including line items.",
  {
    receiptId: z
      .string()
      .describe(
        "The ID of the receipt to retrieve. Can be obtained from list_receipts.",
      ),
  },
  async ({ receiptId }) => {
    const response = await getXeroReceipt(receiptId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting receipt: ${response.error}`,
          },
        ],
      };
    }

    const r = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Receipt details:",
            `Receipt ID: ${r.receiptID}`,
            r.receiptNumber ? `Number: ${r.receiptNumber}` : null,
            r.status ? `Status: ${r.status}` : null,
            r.contact
              ? `Contact: ${r.contact.name} (${r.contact.contactID})`
              : null,
            r.user ? `User: ${r.user.firstName} ${r.user.lastName}` : null,
            r.date ? `Date: ${r.date}` : null,
            r.reference ? `Reference: ${r.reference}` : null,
            r.lineAmountTypes
              ? `Line Amount Types: ${r.lineAmountTypes}`
              : null,
            r.subTotal !== undefined ? `Sub Total: ${r.subTotal}` : null,
            r.totalTax !== undefined ? `Total Tax: ${r.totalTax}` : null,
            r.total !== undefined ? `Total: ${r.total}` : null,
            r.lineItems && r.lineItems.length > 0
              ? `Line Items: ${r.lineItems.map((li) => `${li.description} (Qty: ${li.quantity}, Amount: ${li.unitAmount})`).join("; ")}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default GetReceiptTool;
