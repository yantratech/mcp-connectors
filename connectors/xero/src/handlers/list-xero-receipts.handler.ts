import { xeroClient } from "../clients/xero-client.js";
import { Receipt } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function listXeroReceipts(
  where?: string,
  order?: string,
): Promise<XeroClientResponse<Receipt[]>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getReceipts(
      xeroClient.tenantId,
      undefined, // ifModifiedSince
      where,
      order || "Date DESC",
      undefined, // unitdp
      getClientHeaders(),
    );

    return {
      result: response.body.receipts ?? [],
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
