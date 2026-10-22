import { xeroClient } from "../clients/xero-client.js";
import { receiptsDisabledError } from "../consts/xero-scopes.js";
import { Attachment } from "xero-node";
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
  | "receipts"
  | "accounts"
  | "purchaseOrders"
  | "bankTransfers"
  | "repeatingInvoices";

export async function listXeroAttachments(
  entityType: AttachmentEntityType,
  entityId: string,
): Promise<XeroClientResponse<Attachment[]>> {
  try {
    const receiptsError = receiptsDisabledError(entityType);
    if (receiptsError) {
      return { result: null, isError: true, error: receiptsError };
    }
    await xeroClient.authenticate();

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
      case "accounts":
        response = await xeroClient.accountingApi.getAccountAttachments(
          xeroClient.tenantId,
          entityId,
          getClientHeaders(),
        );
        break;
      case "purchaseOrders":
        response = await xeroClient.accountingApi.getPurchaseOrderAttachments(
          xeroClient.tenantId,
          entityId,
          getClientHeaders(),
        );
        break;
      case "bankTransfers":
        response = await xeroClient.accountingApi.getBankTransferAttachments(
          xeroClient.tenantId,
          entityId,
          getClientHeaders(),
        );
        break;
      case "repeatingInvoices":
        response =
          await xeroClient.accountingApi.getRepeatingInvoiceAttachments(
            xeroClient.tenantId,
            entityId,
            getClientHeaders(),
          );
        break;
    }

    return {
      result: response.body.attachments ?? [],
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
