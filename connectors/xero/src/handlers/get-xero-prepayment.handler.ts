import { xeroClient } from "../clients/xero-client.js";
import { Prepayment } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function getXeroPrepayment(
  prepaymentId: string,
): Promise<XeroClientResponse<Prepayment>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getPrepayment(
      xeroClient.tenantId,
      prepaymentId,
      getClientHeaders(),
    );

    const prepayment = response.body.prepayments?.[0];

    if (!prepayment) {
      return {
        result: null,
        isError: true,
        error: "Prepayment not found.",
      };
    }

    return {
      result: prepayment,
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
