import { xeroClient } from "../clients/xero-client.js";
import { formatError } from "../helpers/format-error.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { PaymentDelete } from "xero-node";

async function deletePayment(paymentID: string): Promise<boolean> {
  await xeroClient.authenticate();

  const paymentDelete: PaymentDelete = {
    status: "DELETED",
  };

  await xeroClient.accountingApi.deletePayment(
    xeroClient.tenantId,
    paymentID,
    paymentDelete,
    undefined, // idempotencyKey
    getClientHeaders(),
  );

  return true;
}

/**
 * Delete a payment in Xero (soft delete by setting status to DELETED)
 */
export async function deleteXeroPayment(
  paymentID: string,
): Promise<XeroClientResponse<boolean>> {
  try {
    await deletePayment(paymentID);

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
