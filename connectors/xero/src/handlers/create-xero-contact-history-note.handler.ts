import { xeroClient } from "../clients/xero-client.js";
import { HistoryRecord, HistoryRecords } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function createXeroContactHistoryNote(
  contactId: string,
  details: string,
): Promise<XeroClientResponse<HistoryRecord>> {
  try {
    await xeroClient.authenticate();

    const historyRecords: HistoryRecords = {
      historyRecords: [{ details }],
    };

    const response = await xeroClient.accountingApi.createContactHistory(
      xeroClient.tenantId,
      contactId,
      historyRecords,
      undefined, // idempotencyKey
      getClientHeaders(),
    );

    const record = response.body.historyRecords?.[0];

    if (!record) {
      return {
        result: null,
        isError: true,
        error: "Failed to create contact history note.",
      };
    }

    return {
      result: record,
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
