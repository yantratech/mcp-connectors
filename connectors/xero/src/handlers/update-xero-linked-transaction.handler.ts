import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { LinkedTransaction, LinkedTransactions } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";

async function updateLinkedTransaction(
  linkedTransactionID: string,
  contactID?: string,
  targetTransactionID?: string,
  targetLineItemID?: string,
): Promise<LinkedTransaction | undefined> {
  await xeroClient.authenticate();

  const linkedTransaction: LinkedTransaction = {
    contactID,
    targetTransactionID,
    targetLineItemID,
  };

  const linkedTransactions: LinkedTransactions = {
    linkedTransactions: [linkedTransaction],
  };

  const response = await xeroClient.accountingApi.updateLinkedTransaction(
    xeroClient.tenantId,
    linkedTransactionID,
    linkedTransactions,
    undefined, // idempotencyKey
    getClientHeaders(),
  );

  return response.body.linkedTransactions?.[0];
}

/**
 * Update an existing linked transaction in Xero
 */
export async function updateXeroLinkedTransaction(
  linkedTransactionID: string,
  contactID?: string,
  targetTransactionID?: string,
  targetLineItemID?: string,
): Promise<XeroClientResponse<LinkedTransaction>> {
  try {
    const updatedLinkedTransaction = await updateLinkedTransaction(
      linkedTransactionID,
      contactID,
      targetTransactionID,
      targetLineItemID,
    );

    if (!updatedLinkedTransaction) {
      throw new Error("Linked transaction update failed.");
    }

    return {
      result: updatedLinkedTransaction,
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
