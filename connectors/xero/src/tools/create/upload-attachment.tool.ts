import { z } from "zod";
import { uploadXeroAttachment } from "../../handlers/upload-xero-attachment.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const UploadAttachmentTool = CreateXeroTool(
  "upload_attachment",
  "Upload a file attachment to a Xero entity (invoice, contact, manual journal, \
  bank transaction, credit note, quote, or receipt). \
  Provide one of: fileUrl (preferred from sandboxed environments — server fetches the file directly), \
  filePath (a file staged with prepare_attachment, or one under the operator-configured XERO_UPLOAD_DIR), \
  or fileContent (base64-encoded). \
  Priority: fileUrl > fileContent > filePath. \
  The attachment is NOT shown to the customer on the online invoice/credit note unless includeOnline is true.",
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
      .describe("The type of entity to attach the file to. The receipts type requires XERO_ENABLE_RECEIPTS=1."),
    entityId: z
      .string()
      .describe("The ID of the entity to attach the file to."),
    fileName: z
      .string()
      .describe(
        "The name the file should have in Xero (e.g. 'receipt.pdf').",
      ),
    filePath: z
      .string()
      .optional()
      .describe(
        "Absolute path of a local file to upload. Only files staged with prepare_attachment, or inside the directory set by the XERO_UPLOAD_DIR environment variable, are accepted; symlinks, non-regular files and files over 10 MB are refused.",
      ),
    fileContent: z
      .string()
      .optional()
      .describe(
        "Base64-encoded file content. Use this instead of filePath when the file is not on the local filesystem (e.g. when called from a sandboxed environment). If both fileContent and filePath are provided, fileContent takes precedence.",
      ),
    fileUrl: z
      .string()
      .optional()
      .describe(
        "HTTP/HTTPS URL to fetch the file from. The MCP server downloads the file directly, so no file content passes through the conversation. This is the best option when calling from a sandboxed environment. Takes precedence over fileContent and filePath. Must be a public http/https URL; private, loopback, and link-local hosts (and oversize files) are rejected.",
      ),
    contentType: z
      .string()
      .regex(/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/, {
        message: "contentType must be a MIME type such as 'application/pdf'",
      })
      .describe(
        "The MIME type of the file (e.g. 'application/pdf', 'image/png', 'image/jpeg'). Sent to Xero as the attachment's content type.",
      ),
    includeOnline: z
      .boolean()
      .optional()
      .describe(
        "Invoices and credit notes only: also show the attachment to the customer on the online invoice / credit note. Defaults to false. Only set true when the user explicitly asks for the customer to see the file.",
      ),
  },
  async ({
    entityType,
    entityId,
    fileName,
    filePath,
    fileContent,
    fileUrl,
    contentType,
    includeOnline,
  }) => {
    if (!fileUrl && !fileContent && !filePath) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Error: At least one of fileUrl, fileContent, or filePath must be provided.",
          },
        ],
      };
    }

    const result = await uploadXeroAttachment(
      entityType,
      entityId,
      fileName,
      contentType,
      fileUrl,
      fileContent,
      filePath,
      includeOnline ?? false,
    );

    if (result.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error uploading attachment: ${result.error}`,
          },
        ],
      };
    }

    const attachment = result.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Attachment uploaded successfully:",
            `Attachment ID: ${attachment.attachmentID}`,
            `File Name: ${attachment.fileName}`,
            attachment.mimeType ? `Type: ${attachment.mimeType}` : null,
            attachment.contentLength !== undefined
              ? `Size: ${attachment.contentLength} bytes`
              : null,
            attachment.url ? `URL: ${attachment.url}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default UploadAttachmentTool;
