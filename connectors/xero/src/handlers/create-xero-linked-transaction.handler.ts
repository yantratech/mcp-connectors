import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { LinkedTransaction } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";

async function createLinkedTransaction(
  sourceTransactionID: string,
  sourceLineItemID: string,
): Promise<LinkedTransaction | undefined> {
  await xeroClient.authenticate();

  const linkedTransaction: LinkedTransaction = {
    sourceTransactionID,
    sourceLineItemID,
  };

  const response = await xeroClient.accountingApi.createLinkedTransaction(
    xeroClient.tenantId,
    linkedTransaction,
    undefined, // idempotencyKey
    getClientHeaders(),
  );

  return response.body.linkedTransactions?.[0];
}

/**
 * Create a new linked transaction in Xero
 */
export async function createXeroLinkedTransaction(
  sourceTransactionID: string,
  sourceLineItemID: string,
): Promise<XeroClientResponse<LinkedTransaction>> {
  try {
    const createdLinkedTransaction = await createLinkedTransaction(
      sourceTransactionID,
      sourceLineItemID,
    );

    if (!createdLinkedTransaction) {
      throw new Error("Linked transaction creation failed.");
    }

    return {
      result: createdLinkedTransaction,
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
