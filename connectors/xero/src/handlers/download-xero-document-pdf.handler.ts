import { xeroClient } from "../clients/xero-client.js";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { saveBinaryResponse } from "../helpers/save-binary-response.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export type PdfDocumentType =
  | "invoice"
  | "credit_note"
  | "quote"
  | "purchase_order";

export interface DownloadedDocumentPdf {
  path: string;
  sizeBytes: number;
  contentType: "application/pdf";
  documentNumber: string | null;
  status: string | null;
  suggestedFileName: string;
}

interface DocumentMetadata {
  number: string | null;
  status: string | null;
}

// Resolve the document number + status up front: it gives a clean 404 for a
// bad ID before any bytes are fetched, and feeds the suggested file name.
async function getDocumentMetadata(
  documentType: PdfDocumentType,
  documentId: string,
): Promise<DocumentMetadata> {
  switch (documentType) {
    case "invoice": {
      const response = await xeroClient.accountingApi.getInvoice(
        xeroClient.tenantId,
        documentId,
        undefined, // unitdp
        getClientHeaders(),
      );
      const invoice = response.body.invoices?.[0];
      if (!invoice) throw new Error(`Invoice ${documentId} not found.`);
      return {
        number: invoice.invoiceNumber ?? null,
        status: invoice.status != null ? String(invoice.status) : null,
      };
    }
    case "credit_note": {
      const response = await xeroClient.accountingApi.getCreditNote(
        xeroClient.tenantId,
        documentId,
        undefined, // unitdp
        getClientHeaders(),
      );
      const creditNote = response.body.creditNotes?.[0];
      if (!creditNote) throw new Error(`Credit note ${documentId} not found.`);
      return {
        number: creditNote.creditNoteNumber ?? null,
        status: creditNote.status != null ? String(creditNote.status) : null,
      };
    }
    case "quote": {
      const response = await xeroClient.accountingApi.getQuote(
        xeroClient.tenantId,
        documentId,
        getClientHeaders(),
      );
      const quote = response.body.quotes?.[0];
      if (!quote) throw new Error(`Quote ${documentId} not found.`);
      return {
        number: quote.quoteNumber ?? null,
        status: quote.status != null ? String(quote.status) : null,
      };
    }
    case "purchase_order": {
      const response = await xeroClient.accountingApi.getPurchaseOrder(
        xeroClient.tenantId,
        documentId,
        getClientHeaders(),
      );
      const purchaseOrder = response.body.purchaseOrders?.[0];
      if (!purchaseOrder)
        throw new Error(`Purchase order ${documentId} not found.`);
      return {
        number: purchaseOrder.purchaseOrderNumber ?? null,
        status:
          purchaseOrder.status != null ? String(purchaseOrder.status) : null,
      };
    }
  }
}

// All four SDK methods return body: Buffer (responseType arraybuffer).
async function getDocumentPdf(
  documentType: PdfDocumentType,
  documentId: string,
): Promise<Buffer> {
  switch (documentType) {
    case "invoice": {
      const response = await xeroClient.accountingApi.getInvoiceAsPdf(
        xeroClient.tenantId,
        documentId,
        getClientHeaders(),
      );
      return response.body;
    }
    case "credit_note": {
      const response = await xeroClient.accountingApi.getCreditNoteAsPdf(
        xeroClient.tenantId,
        documentId,
        getClientHeaders(),
      );
      return response.body;
    }
    case "quote": {
      const response = await xeroClient.accountingApi.getQuoteAsPdf(
        xeroClient.tenantId,
        documentId,
        getClientHeaders(),
      );
      return response.body;
    }
    case "purchase_order": {
      const response = await xeroClient.accountingApi.getPurchaseOrderAsPdf(
        xeroClient.tenantId,
        documentId,
        getClientHeaders(),
      );
      return response.body;
    }
  }
}

function buildSuggestedFileName(
  documentType: PdfDocumentType,
  documentNumber: string | null,
  documentId: string,
): string {
  const label = documentNumber ?? documentId;
  const safeLabel = label.replace(/[^A-Za-z0-9._-]+/g, "_");
  return `${documentType.replace("_", "-")}-${safeLabel}.pdf`;
}

export async function downloadXeroDocumentPdf(
  documentType: PdfDocumentType,
  documentId: string,
  outputPath: string,
  overwrite: boolean,
): Promise<XeroClientResponse<DownloadedDocumentPdf>> {
  try {
    await xeroClient.authenticate();

    const metadata = await getDocumentMetadata(documentType, documentId);
    const pdf = await getDocumentPdf(documentType, documentId);
    const saved = saveBinaryResponse(outputPath, pdf, overwrite);

    return {
      result: {
        path: saved.path,
        sizeBytes: saved.sizeBytes,
        contentType: "application/pdf",
        documentNumber: metadata.number,
        status: metadata.status,
        suggestedFileName: buildSuggestedFileName(
          documentType,
          metadata.number,
          documentId,
        ),
      },
      isError: false,
      error: null,
    };
  } catch (error) {
    return {
      result: null,
      isError: true,
      error: formatError(error),
    };
  }
}
