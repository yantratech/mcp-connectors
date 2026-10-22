import { updateXeroLinkedTransaction } from "../../handlers/update-xero-linked-transaction.handler.js";
import { z } from "zod";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const UpdateLinkedTransactionTool = CreateXeroTool(
  "update_linked_transaction",
  "Update a linked transaction (billable expense) in Xero. Use this to assign a contact or target transaction to an existing linked transaction.",
  {
    linkedTransactionID: z.string().describe("The ID of the linked transaction to update"),
    contactID: z.string().optional().describe("The contact ID to assign the billable expense to"),
    targetTransactionID: z.string().optional().describe("The target transaction ID (ACCREC invoice) to allocate to"),
    targetLineItemID: z.string().optional().describe("The target line item ID to allocate to"),
  },
  async ({
    linkedTransactionID,
    contactID,
    targetTransactionID,
    targetLineItemID,
  }: {
    linkedTransactionID: string;
    contactID?: string;
    targetTransactionID?: string;
    targetLineItemID?: string;
  }) => {
    const response = await updateXeroLinkedTransaction(
      linkedTransactionID,
      contactID,
      targetTransactionID,
      targetLineItemID,
    );

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error updating linked transaction: ${response.error}`,
          },
        ],
      };
    }

    const lt = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            `Linked transaction updated: ${lt.linkedTransactionID}`,
            lt.contactID ? `Contact ID: ${lt.contactID}` : null,
            lt.targetTransactionID ? `Target Transaction ID: ${lt.targetTransactionID}` : null,
            `Status: ${lt.status || "Unknown"}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default UpdateLinkedTransactionTool;
