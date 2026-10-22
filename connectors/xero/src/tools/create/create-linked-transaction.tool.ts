import { createXeroLinkedTransaction } from "../../handlers/create-xero-linked-transaction.handler.js";
import { z } from "zod";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const CreateLinkedTransactionTool = CreateXeroTool(
  "create_linked_transaction",
  "Create a linked transaction (billable expense) in Xero. Links a line item from a source transaction (ACCPAY invoice or bank transaction) to be billed to a contact.",
  {
    sourceTransactionID: z.string().describe("The ID of the source transaction (ACCPAY invoice or bank transaction)"),
    sourceLineItemID: z.string().describe("The line item ID from the source transaction"),
  },
  async ({
    sourceTransactionID,
    sourceLineItemID,
  }: {
    sourceTransactionID: string;
    sourceLineItemID: string;
  }) => {
    const response = await createXeroLinkedTransaction(
      sourceTransactionID,
      sourceLineItemID,
    );

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error creating linked transaction: ${response.error}`,
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
            `Linked transaction created: ${lt.linkedTransactionID}`,
            `Status: ${lt.status || "Unknown"}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default CreateLinkedTransactionTool;
