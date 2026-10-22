import path from "path";
import { z } from "zod";

import { downloadXeroDocumentPdf } from "../../handlers/download-xero-document-pdf.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const DownloadDocumentPdfTool = CreateXeroTool(
  "download_document_pdf",
  "Download a Xero document as a PDF file to a local path. \
  Supports invoices (sales invoices and ACCPAY bills), credit notes, quotes, and purchase orders. \
  The PDF bytes are written directly to outputPath and never returned inline; \
  the response contains the written path, size in bytes, and document metadata.",
  {
    documentType: z
      .enum(["invoice", "credit_note", "quote", "purchase_order"])
      .describe("The type of document to download as PDF."),
    documentId: z
      .string()
      .describe(
        "The ID of the document (e.g. invoice ID, credit note ID, quote ID, purchase order ID).",
      ),
    outputPath: z
      .string()
      .refine((value) => path.isAbsolute(value), {
        message: "outputPath must be an absolute path",
      })
      .describe(
        "Absolute local file path to write the PDF to (e.g. /tmp/invoice.pdf). \
        The parent directory must already exist.",
      ),
    overwrite: z
      .boolean()
      .optional()
      .describe(
        "Replace an existing file at outputPath. Defaults to false (refuse to overwrite).",
      ),
  },
  async ({ documentType, documentId, outputPath, overwrite }) => {
    const response = await downloadXeroDocumentPdf(
      documentType,
      documentId,
      outputPath,
      overwrite ?? false,
    );

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error downloading document PDF: ${response.error}`,
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
            "Document PDF downloaded:",
            `Path: ${download.path}`,
            `Size: ${download.sizeBytes} bytes`,
            `Content Type: ${download.contentType}`,
            download.documentNumber
              ? `Document Number: ${download.documentNumber}`
              : null,
            download.status ? `Status: ${download.status}` : null,
            `Suggested File Name: ${download.suggestedFileName}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default DownloadDocumentPdfTool;
