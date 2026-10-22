import { Attachments } from "xero-node";
import { receiptsDisabledError } from "../consts/xero-scopes.js";

import { xeroClient } from "../clients/xero-client.js";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { saveBinaryResponse } from "../helpers/save-binary-response.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export type AttachmentDownloadEntityType =
  | "invoices"
  | "contacts"
  | "manualJournals"
  | "bankTransactions"
  | "creditNotes"
  | "quotes"
  | "receipts"
  | "accounts"
  | "purchaseOrders"
  | "bankTransfers"
  | "repeatingInvoices";

export interface DownloadedAttachment {
  path: string;
  sizeBytes: number;
  fileName: string;
  contentType: string;
}

interface AttachmentBinding {
  list: (entityId: string) => Promise<{ body: Attachments }>;
  // The SDK requires the attachment's mime type as the Accept header for the
  // binary fetch; it is resolved from the metadata listing first.
  getById: (
    entityId: string,
    attachmentId: string,
    contentType: string,
  ) => Promise<{ body: Buffer }>;
}

const api = () => xeroClient.accountingApi;
const tenant = () => xeroClient.tenantId;

const ATTACHMENT_BINDINGS: Record<
  AttachmentDownloadEntityType,
  AttachmentBinding
> = {
  invoices: {
    list: (id) => api().getInvoiceAttachments(tenant(), id, getClientHeaders()),
    getById: (id, attachmentId, contentType) =>
      api().getInvoiceAttachmentById(
        tenant(),
        id,
        attachmentId,
        contentType,
        getClientHeaders(),
      ),
  },
  contacts: {
    list: (id) => api().getContactAttachments(tenant(), id, getClientHeaders()),
    getById: (id, attachmentId, contentType) =>
      api().getContactAttachmentById(
        tenant(),
        id,
        attachmentId,
        contentType,
        getClientHeaders(),
      ),
  },
  manualJournals: {
    list: (id) =>
      api().getManualJournalAttachments(tenant(), id, getClientHeaders()),
    getById: (id, attachmentId, contentType) =>
      api().getManualJournalAttachmentById(
        tenant(),
        id,
        attachmentId,
        contentType,
        getClientHeaders(),
      ),
  },
  bankTransactions: {
    list: (id) =>
      api().getBankTransactionAttachments(tenant(), id, getClientHeaders()),
    getById: (id, attachmentId, contentType) =>
      api().getBankTransactionAttachmentById(
        tenant(),
        id,
        attachmentId,
        contentType,
        getClientHeaders(),
      ),
  },
  creditNotes: {
    list: (id) =>
      api().getCreditNoteAttachments(tenant(), id, getClientHeaders()),
    getById: (id, attachmentId, contentType) =>
      api().getCreditNoteAttachmentById(
        tenant(),
        id,
        attachmentId,
        contentType,
        getClientHeaders(),
      ),
  },
  quotes: {
    list: (id) => api().getQuoteAttachments(tenant(), id, getClientHeaders()),
    getById: (id, attachmentId, contentType) =>
      api().getQuoteAttachmentById(
        tenant(),
        id,
        attachmentId,
        contentType,
        getClientHeaders(),
      ),
  },
  receipts: {
    list: (id) => api().getReceiptAttachments(tenant(), id, getClientHeaders()),
    getById: (id, attachmentId, contentType) =>
      api().getReceiptAttachmentById(
        tenant(),
        id,
        attachmentId,
        contentType,
        getClientHeaders(),
      ),
  },
  accounts: {
    list: (id) => api().getAccountAttachments(tenant(), id, getClientHeaders()),
    getById: (id, attachmentId, contentType) =>
      api().getAccountAttachmentById(
        tenant(),
        id,
        attachmentId,
        contentType,
        getClientHeaders(),
      ),
  },
  purchaseOrders: {
    list: (id) =>
      api().getPurchaseOrderAttachments(tenant(), id, getClientHeaders()),
    getById: (id, attachmentId, contentType) =>
      api().getPurchaseOrderAttachmentById(
        tenant(),
        id,
        attachmentId,
        contentType,
        getClientHeaders(),
      ),
  },
  bankTransfers: {
    list: (id) =>
      api().getBankTransferAttachments(tenant(), id, getClientHeaders()),
    getById: (id, attachmentId, contentType) =>
      api().getBankTransferAttachmentById(
        tenant(),
        id,
        attachmentId,
        contentType,
        getClientHeaders(),
      ),
  },
  repeatingInvoices: {
    list: (id) =>
      api().getRepeatingInvoiceAttachments(tenant(), id, getClientHeaders()),
    getById: (id, attachmentId, contentType) =>
      api().getRepeatingInvoiceAttachmentById(
        tenant(),
        id,
        attachmentId,
        contentType,
        getClientHeaders(),
      ),
  },
};

export async function downloadXeroAttachment(
  entityType: AttachmentDownloadEntityType,
  entityId: string,
  attachmentId: string,
  outputPath: string,
  overwrite: boolean,
): Promise<XeroClientResponse<DownloadedAttachment>> {
  try {
    const receiptsError = receiptsDisabledError(entityType);
    if (receiptsError) {
      return { result: null, isError: true, error: receiptsError };
    }
    await xeroClient.authenticate();

    const binding = ATTACHMENT_BINDINGS[entityType];

    // Metadata lookup first: the listing carries the mimeType and fileName
    // the binary getById call needs for content negotiation.
    const listResponse = await binding.list(entityId);
    const attachment = (listResponse.body.attachments ?? []).find(
      (a) => a.attachmentID?.toLowerCase() === attachmentId.toLowerCase(),
    );
    if (!attachment) {
      throw new Error(
        `Attachment ${attachmentId} not found on ${entityType} ${entityId}`,
      );
    }

    const contentType = attachment.mimeType ?? "application/octet-stream";
    const fileName = attachment.fileName ?? attachmentId;

    const contentResponse = await binding.getById(
      entityId,
      attachmentId,
      contentType,
    );
    const saved = saveBinaryResponse(
      outputPath,
      contentResponse.body,
      overwrite,
    );

    return {
      result: {
        path: saved.path,
        sizeBytes: saved.sizeBytes,
        fileName,
        contentType,
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
