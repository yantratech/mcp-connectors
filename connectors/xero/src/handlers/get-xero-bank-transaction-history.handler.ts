import { xeroClient } from "../clients/xero-client.js";
import { HistoryRecord } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function getXeroBankTransactionHistory(
  bankTransactionId: string,
): Promise<XeroClientResponse<HistoryRecord[]>> {
  try {
    await xeroClient.authenticate();

    const response =
      await xeroClient.accountingApi.getBankTransactionsHistory(
        xeroClient.tenantId,
        bankTransactionId,
        getClientHeaders(),
      );

    const historyRecords = response.body.historyRecords;

    if (!historyRecords || historyRecords.length === 0) {
      return {
        result: null,
        isError: true,
        error: "No history records found for this bank transaction. Caution: Xero also returns an empty history list (HTTP 200) when no bank transaction with this ID exists, so this can mean EITHER the transaction has no history OR the ID is wrong — verify the ID with get_bank_transaction before concluding anything.",
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
