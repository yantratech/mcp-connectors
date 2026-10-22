import path from "path";
import { z } from "zod";

import { downloadXeroAttachment } from "../../handlers/download-xero-attachment.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const DownloadAttachmentTool = CreateXeroTool(
  "download_attachment",
  "Download the binary content of an attachment from a Xero entity to a local path. \
  Resolves the attachment's file name and content type from its metadata first, then \
  writes the bytes directly to outputPath (never returned inline). \
  Xero caps attachments at 25 MB and the whole file is buffered in memory while downloading.",
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
      .describe("The type of entity the attachment belongs to. The receipts type requires XERO_ENABLE_RECEIPTS=1."),
    entityId: z
      .string()
      .describe("The ID of the entity (e.g. invoice ID, contact ID)."),
    attachmentId: z
      .string()
      .describe(
        "The ID of the attachment to download. Can be obtained from list_attachments.",
      ),
    outputPath: z
      .string()
      .refine((value) => path.isAbsolute(value), {
        message: "outputPath must be an absolute path",
      })
      .describe(
        "Absolute local file path to write the attachment to. \
        The parent directory must already exist.",
      ),
    overwrite: z
      .boolean()
      .optional()
      .describe(
        "Replace an existing file at outputPath. Defaults to false (refuse to overwrite).",
      ),
  },
  async ({ entityType, entityId, attachmentId, outputPath, overwrite }) => {
    const response = await downloadXeroAttachment(
      entityType,
      entityId,
      attachmentId,
      outputPath,
      overwrite ?? false,
    );

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error downloading attachment: ${response.error}`,
          },
        ],
      };
    }

    const download = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Attachment downloaded:",
            `Path: ${download.path}`,
            `Size: ${download.sizeBytes} bytes`,
            `File Name: ${download.fileName}`,
            `Content Type: ${download.contentType}`,
          ].join("\n"),
        },
      ],
    };
  },
);

export default DownloadAttachmentTool;
