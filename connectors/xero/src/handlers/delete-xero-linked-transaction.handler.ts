import { xeroClient } from "../clients/xero-client.js";
import { formatError } from "../helpers/format-error.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { getClientHeaders } from "../helpers/get-client-headers.js";

async function deleteLinkedTransaction(linkedTransactionID: string): Promise<boolean> {
  await xeroClient.authenticate();

  await xeroClient.accountingApi.deleteLinkedTransaction(
    xeroClient.tenantId,
    linkedTransactionID,
    getClientHeaders(),
  );

  return true;
}

/**
 * Delete a linked transaction in Xero
 */
export async function deleteXeroLinkedTransaction(linkedTransactionID: string): Promise<
  XeroClientResponse<boolean>
> {
  try {
    await deleteLinkedTransaction(linkedTransactionID);

    return {
      result: true,
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
