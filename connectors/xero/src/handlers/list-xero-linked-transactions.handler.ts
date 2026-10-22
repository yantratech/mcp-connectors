import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { LinkedTransaction } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";

async function listLinkedTransactions(
  page?: number,
  sourceTransactionID?: string,
  contactID?: string,
  status?: string,
  targetTransactionID?: string,
): Promise<LinkedTransaction[]> {
  await xeroClient.authenticate();

  const response = await xeroClient.accountingApi.getLinkedTransactions(
    xeroClient.tenantId,
    page,
    undefined, // linkedTransactionID
    sourceTransactionID,
    contactID,
    status,
    targetTransactionID,
    getClientHeaders(),
  );

  const linkedTransactions = response.body.linkedTransactions ?? [];
  return linkedTransactions;
}

/**
 * List linked transactions from Xero
 */
export async function listXeroLinkedTransactions(
  page?: number,
  sourceTransactionID?: string,
  contactID?: string,
  status?: string,
  targetTransactionID?: string,
): Promise<XeroClientResponse<LinkedTransaction[]>> {
  try {
    const linkedTransactions = await listLinkedTransactions(
      page,
      sourceTransactionID,
      contactID,
      status,
      targetTransactionID,
    );

    return {
      result: linkedTransactions,
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
