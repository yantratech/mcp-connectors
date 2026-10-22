import { xeroClient } from "../clients/xero-client.js";
import { PurchaseOrder } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

interface LineItemInput {
  description: string;
  quantity: number;
  unitAmount: number;
  accountCode: string;
  taxType: string;
  itemCode?: string;
}

export async function updateXeroPurchaseOrder(
  purchaseOrderId: string,
  lineItems?: LineItemInput[],
  date?: string,
  deliveryDate?: string,
  reference?: string,
  status?: string,
): Promise<XeroClientResponse<PurchaseOrder>> {
  try {
    await xeroClient.authenticate();

    const purchaseOrder: PurchaseOrder = {};

    if (lineItems) {
      purchaseOrder.lineItems = lineItems.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitAmount: item.unitAmount,
        accountCode: item.accountCode,
        taxType: item.taxType,
        itemCode: item.itemCode,
      }));
    }
    if (date) {
      purchaseOrder.date = date;
    }
    if (deliveryDate) {
      purchaseOrder.deliveryDate = deliveryDate;
    }
    if (reference) {
      purchaseOrder.reference = reference;
    }
    if (status) {
      purchaseOrder.status = status as unknown as PurchaseOrder.StatusEnum;
    }

    const response = await xeroClient.accountingApi.updatePurchaseOrder(
      xeroClient.tenantId,
      purchaseOrderId,
      { purchaseOrders: [purchaseOrder] },
      undefined, // idempotencyKey
      getClientHeaders(),
    );

    const updated = response.body.purchaseOrders?.[0];

    if (!updated) {
      return {
        result: null,
        isError: true,
        error: "Failed to update purchase order.",
      };
    }

    return {
      result: updated,
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
