import { xeroClient } from "../clients/xero-client.js";
import { Payment } from "xero-node";

import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function getXeroPayment(
  paymentId: string,
): Promise<XeroClientResponse<Payment>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getPayment(
      xeroClient.tenantId,
      paymentId,
    );

    const payment = response.body.payments?.[0];

    if (!payment) {
      return {
        result: null,
        isError: true,
        error: "Payment not found.",
      };
    }

    return {
      result: payment,
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
