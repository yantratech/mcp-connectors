import { z } from "zod";
import { getXeroAttachmentById } from "../../handlers/get-xero-attachment.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetAttachmentTool = CreateXeroTool(
  "get_attachment",
  "Get a specific attachment by ID from a Xero entity. \
  Returns the content type, file name, and download URL of the attachment.",
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
      ])
      .describe("The type of entity the attachment belongs to. The receipts type requires XERO_ENABLE_RECEIPTS=1."),
    entityId: z
      .string()
      .describe("The ID of the entity (e.g. invoice ID, contact ID)."),
    attachmentId: z
      .string()
      .describe(
        "The ID of the attachment to retrieve. Can be obtained from list_attachments.",
      ),
  },
  async ({ entityType, entityId, attachmentId }) => {
    const response = await getXeroAttachmentById(
      entityType,
      entityId,
      attachmentId,
    );

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting attachment: ${response.error}`,
          },
        ],
      };
    }

    const attachment = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Attachment details:",
            `Content Type: ${attachment.contentType}`,
            `File Name: ${attachment.fileName}`,
            attachment.url ? `URL: ${attachment.url}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default GetAttachmentTool;
