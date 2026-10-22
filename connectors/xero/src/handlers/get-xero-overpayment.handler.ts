import { xeroClient } from "../clients/xero-client.js";
import { Overpayment } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function getXeroOverpayment(
  overpaymentId: string,
): Promise<XeroClientResponse<Overpayment>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getOverpayment(
      xeroClient.tenantId,
      overpaymentId,
      getClientHeaders(),
    );

    const overpayment = response.body.overpayments?.[0];

    if (!overpayment) {
      return {
        result: null,
        isError: true,
        error: "Overpayment not found.",
      };
    }

    return {
      result: overpayment,
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
