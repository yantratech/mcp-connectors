import { xeroClient } from "../clients/xero-client.js";
import { PurchaseOrder } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function listXeroPurchaseOrders(
  page: number = 1,
  status?: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<XeroClientResponse<PurchaseOrder[]>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getPurchaseOrders(
      xeroClient.tenantId,
      undefined, // ifModifiedSince
      status as "DRAFT" | "SUBMITTED" | "AUTHORISED" | "BILLED" | "DELETED" | undefined,
      dateFrom,
      dateTo,
      "DateString DESC", // order
      page,
      10, // pageSize
      getClientHeaders(),
    );

    return {
      result: response.body.purchaseOrders ?? [],
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
