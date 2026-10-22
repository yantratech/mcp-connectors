import { z } from "zod";
import { listXeroAttachments } from "../../handlers/list-xero-attachments.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListAttachmentsTool = CreateXeroTool(
  "list_attachments",
  "List attachments on a Xero entity (invoice, contact, manual journal, bank transaction, \
  credit note, quote, receipt, account, purchase order, bank transfer, or repeating invoice). \
  Returns the file name, size, and content type of each attachment.",
  {
    entityType: z
      .enum([
        "invoices",
        "contacts",
        "manualJournals",
        "bankTransactions",
        "creditNotes",
        "quotes",
        "receipts",
        "accounts",
        "purchaseOrders",
        "bankTransfers",
        "repeatingInvoices",
      ])
      .describe("The type of entity to list attachments for. The receipts type requires XERO_ENABLE_RECEIPTS=1."),
    entityId: z
      .string()
      .describe(
        "The ID of the entity (e.g. invoice ID, contact ID). Can be obtained from the corresponding list tool.",
      ),
  },
  async ({ entityType, entityId }) => {
    const response = await listXeroAttachments(entityType, entityId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing attachments: ${response.error}`,
          },
        ],
      };
    }

    const attachments = response.result;

    const header =
      (attachments?.length ?? 0) === 0
        ? `Found 0 attachments. Note: Xero returns an empty list (HTTP 200) even when the ${entityType} ID does not exist — this does NOT confirm the entity exists or has no attachments. Verify the ID with the matching get/list tool first (e.g. get_invoice for invoices).`
        : `Found ${attachments?.length} attachments:`;

    return {
      content: [
        {
          type: "text" as const,
          text: header,
        },
        ...(attachments?.map((a) => ({
          type: "text" as const,
          text: [
            `Attachment ID: ${a.attachmentID}`,
            `File Name: ${a.fileName}`,
            a.mimeType ? `Type: ${a.mimeType}` : null,
            a.contentLength !== undefined
              ? `Size: ${a.contentLength} bytes`
              : null,
            a.url ? `URL: ${a.url}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
);

export default ListAttachmentsTool;
