import { z } from "zod";
import { listXeroReceipts } from "../../handlers/list-xero-receipts.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListReceiptsTool = CreateXeroTool(
  "list_receipts",
  "List receipts (expense claims) in Xero. Receipts represent expense claims \
  submitted by users for reimbursement.",
  {
    status: z
      .enum(["DRAFT", "SUBMITTED", "AUTHORISED", "DECLINED", "VOIDED"])
      .optional()
      .describe("Filter by receipt status."),
  },
  async ({ status }) => {
    const where = status ? `Status=="${status}"` : undefined;
    const response = await listXeroReceipts(where);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing receipts: ${response.error}`,
          },
        ],
      };
    }

    const receipts = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${receipts?.length || 0} receipts:`,
        },
        ...(receipts?.map((r) => ({
          type: "text" as const,
          text: [
            `Receipt ID: ${r.receiptID}`,
            r.receiptNumber ? `Number: ${r.receiptNumber}` : null,
            r.status ? `Status: ${r.status}` : null,
            r.contact
              ? `Contact: ${r.contact.name} (${r.contact.contactID})`
              : null,
            r.user ? `User: ${r.user.firstName} ${r.user.lastName}` : null,
            r.date ? `Date: ${r.date}` : null,
            r.reference ? `Reference: ${r.reference}` : null,
            r.subTotal !== undefined ? `Sub Total: ${r.subTotal}` : null,
            r.totalTax !== undefined ? `Total Tax: ${r.totalTax}` : null,
            r.total !== undefined ? `Total: ${r.total}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
);

export default ListReceiptsTool;
