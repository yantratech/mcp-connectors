import { xeroClient } from "../clients/xero-client.js";
import { Overpayment } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function listXeroOverpayments(
  page: number = 1,
): Promise<XeroClientResponse<Overpayment[]>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getOverpayments(
      xeroClient.tenantId,
      undefined, // ifModifiedSince
      undefined, // where
      "Date DESC", // order
      page,
      undefined, // unitdp
      10, // pageSize
      undefined, // references
      getClientHeaders(),
    );

    return {
      result: response.body.overpayments ?? [],
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
