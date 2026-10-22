import { xeroClient } from "../clients/xero-client.js";
import { receiptsDisabledError } from "../consts/xero-scopes.js";
import { HistoryRecord } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

// Entity types covered by the get_history dispatcher. Invoices, contacts and
// bank transactions are deliberately excluded: they keep their dedicated
// get_invoice_history / get_contact_history / get_bank_transaction_history
// tools (pinned names).
export type HistoryEntityType =
  | "creditNotes"
  | "payments"
  | "purchaseOrders"
  | "quotes"
  | "items"
  | "manualJournals"
  | "bankTransfers"
  | "prepayments"
  | "overpayments"
  | "receipts"
  | "repeatingInvoices";

export async function getXeroHistory(
  entityType: HistoryEntityType,
  entityId: string,
): Promise<XeroClientResponse<HistoryRecord[]>> {
  try {
    const receiptsError = receiptsDisabledError(entityType);
    if (receiptsError) {
      return { result: null, isError: true, error: receiptsError };
    }
    await xeroClient.authenticate();

    let response;
    switch (entityType) {
      case "creditNotes":
        response = await xeroClient.accountingApi.getCreditNoteHistory(
          xeroClient.tenantId,
          entityId,
          getClientHeaders(),
        );
        break;
      case "payments":
        response = await xeroClient.accountingApi.getPaymentHistory(
          xeroClient.tenantId,
          entityId,
          getClientHeaders(),
        );
        break;
      case "purchaseOrders":
        response = await xeroClient.accountingApi.getPurchaseOrderHistory(
          xeroClient.tenantId,
          entityId,
          getClientHeaders(),
        );
        break;
      case "quotes":
        response = await xeroClient.accountingApi.getQuoteHistory(
          xeroClient.tenantId,
          entityId,
          getClientHeaders(),
        );
        break;
      case "items":
        response = await xeroClient.accountingApi.getItemHistory(
          xeroClient.tenantId,
          entityId,
          getClientHeaders(),
        );
        break;
      case "manualJournals":
        // Note the plural "Journals" in the SDK method name.
        response = await xeroClient.accountingApi.getManualJournalsHistory(
          xeroClient.tenantId,
          entityId,
          getClientHeaders(),
        );
        break;
      case "bankTransfers":
        response = await xeroClient.accountingApi.getBankTransferHistory(
          xeroClient.tenantId,
          entityId,
          getClientHeaders(),
        );
        break;
      case "prepayments":
        response = await xeroClient.accountingApi.getPrepaymentHistory(
          xeroClient.tenantId,
          entityId,
          getClientHeaders(),
        );
        break;
      case "overpayments":
        response = await xeroClient.accountingApi.getOverpaymentHistory(
          xeroClient.tenantId,
          entityId,
          getClientHeaders(),
        );
        break;
      case "receipts":
        response = await xeroClient.accountingApi.getReceiptHistory(
          xeroClient.tenantId,
          entityId,
          getClientHeaders(),
        );
        break;
      case "repeatingInvoices":
        response = await xeroClient.accountingApi.getRepeatingInvoiceHistory(
          xeroClient.tenantId,
          entityId,
          getClientHeaders(),
        );
        break;
    }

    const historyRecords = response.body.historyRecords;

    if (!historyRecords || historyRecords.length === 0) {
      return {
        result: null,
        isError: true,
        error: `No history records found for this ${entityType} entity. Caution: Xero also returns an empty history list (HTTP 200) when no entity with this ID exists, so this can mean EITHER the entity has no history OR the ID is wrong — verify the ID with the matching get/list tool before concluding anything.`,
      };
    }

    return {
      result: historyRecords,
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
