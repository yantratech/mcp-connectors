import { xeroClient } from "../clients/xero-client.js";
import { receiptsDisabledError } from "../consts/xero-scopes.js";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

type AttachmentEntityType =
  | "invoices"
  | "contacts"
  | "manualJournals"
  | "bankTransactions"
  | "creditNotes"
  | "quotes"
  | "receipts";

interface AttachmentContent {
  contentType: string;
  fileName: string;
  url: string;
}

export async function getXeroAttachmentById(
  entityType: AttachmentEntityType,
  entityId: string,
  attachmentId: string,
): Promise<XeroClientResponse<AttachmentContent>> {
  try {
    const receiptsError = receiptsDisabledError(entityType);
    if (receiptsError) {
      return { result: null, isError: true, error: receiptsError };
    }
    await xeroClient.authenticate();

    // Fetch the attachment metadata list rather than downloading the file
    // content: it already contains the mimeType, fileName and url.
    let response;
    switch (entityType) {
      case "invoices":
        response = await xeroClient.accountingApi.getInvoiceAttachments(
          xeroClient.tenantId,
          entityId,
          getClientHeaders(),
        );
        break;
      case "contacts":
        response = await xeroClient.accountingApi.getContactAttachments(
          xeroClient.tenantId,
          entityId,
          getClientHeaders(),
        );
        break;
      case "manualJournals":
        response = await xeroClient.accountingApi.getManualJournalAttachments(
          xeroClient.tenantId,
          entityId,
          getClientHeaders(),
        );
        break;
      case "bankTransactions":
        response =
          await xeroClient.accountingApi.getBankTransactionAttachments(
            xeroClient.tenantId,
            entityId,
            getClientHeaders(),
          );
        break;
      case "creditNotes":
        response = await xeroClient.accountingApi.getCreditNoteAttachments(
          xeroClient.tenantId,
          entityId,
          getClientHeaders(),
        );
        break;
      case "quotes":
        response = await xeroClient.accountingApi.getQuoteAttachments(
          xeroClient.tenantId,
          entityId,
          getClientHeaders(),
        );
        break;
      case "receipts":
        response = await xeroClient.accountingApi.getReceiptAttachments(
          xeroClient.tenantId,
          entityId,
          getClientHeaders(),
        );
        break;
    }

    const attachment = (response.body.attachments ?? []).find(
      (a) => a.attachmentID?.toLowerCase() === attachmentId.toLowerCase(),
    );
    if (!attachment) {
      throw new Error(
        `Attachment ${attachmentId} not found on ${entityType} ${entityId}`,
      );
    }

    return {
      result: {
        contentType: attachment.mimeType ?? "application/octet-stream",
        fileName: attachment.fileName ?? attachmentId,
        url: attachment.url ?? "",
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
