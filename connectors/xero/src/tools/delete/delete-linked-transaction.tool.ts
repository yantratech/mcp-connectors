import { z } from "zod";
import { deleteXeroLinkedTransaction } from "../../handlers/delete-xero-linked-transaction.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const DeleteLinkedTransactionTool = CreateXeroTool(
  "delete_linked_transaction",
  "Delete a linked transaction (billable expense) in Xero.",
  {
    linkedTransactionID: z.string().describe("The ID of the linked transaction to delete"),
  },
  async (params: { linkedTransactionID: string }) => {
    const { linkedTransactionID } = params;
    const response = await deleteXeroLinkedTransaction(linkedTransactionID);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error deleting linked transaction: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Successfully deleted linked transaction with ID: ${linkedTransactionID}`,
        },
      ],
    };
  },
);

export default DeleteLinkedTransactionTool;
