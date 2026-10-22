import { xeroClient } from "../clients/xero-client.js";
import { receiptsDisabledError } from "../consts/xero-scopes.js";
import { Attachment } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { safeFetchUrl } from "../helpers/safe-fetch-url.js";
import { readUploadFile } from "../helpers/resolve-upload-path.js";

type AttachmentEntityType =
  | "invoices"
  | "contacts"
  | "manualJournals"
  | "bankTransactions"
  | "creditNotes"
  | "quotes"
  | "receipts";

export async function uploadXeroAttachment(
  entityType: AttachmentEntityType,
  entityId: string,
  fileName: string,
  contentType: string,
  fileUrl?: string,
  fileContent?: string,
  filePath?: string,
  includeOnline: boolean = false,
): Promise<XeroClientResponse<Attachment>> {
  try {
    const receiptsError = receiptsDisabledError(entityType);
    if (receiptsError) {
      return { result: null, isError: true, error: receiptsError };
    }
    if (
      includeOnline &&
      entityType !== "invoices" &&
      entityType !== "creditNotes"
    ) {
      return {
        result: null,
        isError: true,
        error:
          "includeOnline is only supported for invoices and creditNotes attachments.",
      };
    }

    // Resolve the file bytes BEFORE authenticating so an SSRF-blocked or
    // otherwise invalid fileUrl fails fast (with the SSRF reason surfaced)
    // without a wasted token exchange and before any Xero call is made.
    let body: Buffer;
    if (fileUrl) {
      body = await safeFetchUrl(fileUrl);
    } else if (fileContent) {
      body = Buffer.from(fileContent, "base64");
    } else {
      body = readUploadFile(filePath!);
    }

    await xeroClient.authenticate();

    // Send the caller's MIME type as the request Content-Type; Xero records
    // it as the attachment's MimeType.
    const clientHeaders = getClientHeaders();
    const options = {
      headers: { ...clientHeaders.headers, "Content-Type": contentType },
    };

    let response;
    switch (entityType) {
      case "invoices":
        response =
          await xeroClient.accountingApi.createInvoiceAttachmentByFileName(
            xeroClient.tenantId,
            entityId,
            fileName,
            body,
            includeOnline,
            undefined, // idempotencyKey
            options,
          );
        break;
      case "contacts":
        response =
          await xeroClient.accountingApi.createContactAttachmentByFileName(
            xeroClient.tenantId,
            entityId,
            fileName,
            body,
            undefined, // idempotencyKey
            options,
          );
        break;
      case "manualJournals":
        response =
          await xeroClient.accountingApi.createManualJournalAttachmentByFileName(
            xeroClient.tenantId,
            entityId,
            fileName,
            body,
            undefined, // idempotencyKey
            options,
          );
        break;
      case "bankTransactions":
        response =
          await xeroClient.accountingApi.createBankTransactionAttachmentByFileName(
            xeroClient.tenantId,
            entityId,
            fileName,
            body,
            undefined, // idempotencyKey
            options,
          );
        break;
      case "creditNotes":
        response =
          await xeroClient.accountingApi.createCreditNoteAttachmentByFileName(
            xeroClient.tenantId,
            entityId,
            fileName,
            body,
            includeOnline,
            undefined, // idempotencyKey
            options,
          );
        break;
      case "quotes":
        response =
          await xeroClient.accountingApi.createQuoteAttachmentByFileName(
            xeroClient.tenantId,
            entityId,
            fileName,
            body,
            undefined, // idempotencyKey
            options,
          );
        break;
      case "receipts":
        response =
          await xeroClient.accountingApi.createReceiptAttachmentByFileName(
            xeroClient.tenantId,
            entityId,
            fileName,
            body,
            undefined, // idempotencyKey
            options,
          );
        break;
    }

    const attachment = response.body.attachments?.[0];

    if (!attachment) {
      return {
        result: null,
        isError: true,
        error: "Failed to upload attachment.",
      };
    }

    return {
      result: attachment,
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
