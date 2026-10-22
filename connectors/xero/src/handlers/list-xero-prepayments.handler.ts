import { xeroClient } from "../clients/xero-client.js";
import { Prepayment } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function listXeroPrepayments(
  page: number = 1,
): Promise<XeroClientResponse<Prepayment[]>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getPrepayments(
      xeroClient.tenantId,
      undefined, // ifModifiedSince
      undefined, // where
      "Date DESC", // order
      page,
      undefined, // unitdp
      10, // pageSize
      undefined, // invoiceNumbers
      undefined, // references
      getClientHeaders(),
    );

    return {
      result: response.body.prepayments ?? [],
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
