import { xeroClient } from "../clients/xero-client.js";
import { HistoryRecord } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function getXeroInvoiceHistory(
  invoiceId: string,
): Promise<XeroClientResponse<HistoryRecord[]>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getInvoiceHistory(
      xeroClient.tenantId,
      invoiceId,
      getClientHeaders(),
    );

    const historyRecords = response.body.historyRecords;

    if (!historyRecords || historyRecords.length === 0) {
      return {
        result: null,
        isError: true,
        error: "No history records found for this invoice. Caution: Xero also returns an empty history list (HTTP 200) when no invoice with this ID exists, so this can mean EITHER the invoice has no history OR the ID is wrong — verify the ID with get_invoice before concluding anything.",
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
