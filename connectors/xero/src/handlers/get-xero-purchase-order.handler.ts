import { xeroClient } from "../clients/xero-client.js";
import { PurchaseOrder } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function getXeroPurchaseOrder(
  purchaseOrderId: string,
): Promise<XeroClientResponse<PurchaseOrder>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getPurchaseOrder(
      xeroClient.tenantId,
      purchaseOrderId,
      getClientHeaders(),
    );

    const purchaseOrder = response.body.purchaseOrders?.[0];

    if (!purchaseOrder) {
      return {
        result: null,
        isError: true,
        error: "Purchase order not found.",
      };
    }

    return {
      result: purchaseOrder,
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
