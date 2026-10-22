import { listXeroLinkedTransactions } from "../../handlers/list-xero-linked-transactions.handler.js";
import { z } from "zod";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListLinkedTransactionsTool = CreateXeroTool(
  "list_linked_transactions",
  "Lists linked transactions (billable expenses) in Xero. Can filter by source transaction, contact, status, or target transaction.",
  {
    page: z.number().optional().describe("Page number for pagination"),
    sourceTransactionID: z.string().optional().describe("Filter by the source transaction ID (ACCPAY invoice)"),
    contactID: z.string().optional().describe("Filter by contact ID"),
    status: z.string().optional().describe("Filter by status (APPROVED, DRAFT, ONDRAFT, BILLED, VOIDED)"),
    targetTransactionID: z.string().optional().describe("Filter by target transaction ID (ACCREC invoice)"),
  },
  async ({
    page,
    sourceTransactionID,
    contactID,
    status,
    targetTransactionID,
  }: {
    page?: number;
    sourceTransactionID?: string;
    contactID?: string;
    status?: string;
    targetTransactionID?: string;
  }) => {
    const response = await listXeroLinkedTransactions(
      page,
      sourceTransactionID,
      contactID,
      status,
      targetTransactionID,
    );

    if (response.error !== null) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing linked transactions: ${response.error}`,
          },
        ],
      };
    }

    const linkedTransactions = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${linkedTransactions?.length || 0} linked transactions:`,
        },
        ...(linkedTransactions?.map((lt) => ({
          type: "text" as const,
          text: [
            `Linked Transaction ID: ${lt.linkedTransactionID || "N/A"}`,
            `Source Transaction ID: ${lt.sourceTransactionID || "N/A"}`,
            lt.sourceLineItemID ? `Source Line Item ID: ${lt.sourceLineItemID}` : null,
            lt.contactID ? `Contact ID: ${lt.contactID}` : null,
            lt.targetTransactionID ? `Target Transaction ID: ${lt.targetTransactionID}` : null,
            lt.targetLineItemID ? `Target Line Item ID: ${lt.targetLineItemID}` : null,
            `Status: ${lt.status || "Unknown"}`,
            lt.type ? `Type: ${lt.type}` : null,
            lt.updatedDateUTC ? `Updated: ${lt.updatedDateUTC}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
);

export default ListLinkedTransactionsTool;
