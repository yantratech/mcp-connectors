import { xeroClient } from "../clients/xero-client.js";
import { CurrencyCode, PurchaseOrder } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

interface LineItemInput {
  description: string;
  quantity: number;
  unitAmount: number;
  accountCode: string;
  taxType?: string;
  itemCode?: string;
}

export async function createXeroPurchaseOrder(
  contactId: string,
  lineItems: LineItemInput[],
  date?: string,
  deliveryDate?: string,
  reference?: string,
  currencyCode?: string,
): Promise<XeroClientResponse<PurchaseOrder>> {
  try {
    await xeroClient.authenticate();

    const purchaseOrder: PurchaseOrder = {
      contact: { contactID: contactId },
      lineItems: lineItems.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitAmount: item.unitAmount,
        accountCode: item.accountCode,
        ...(item.taxType ? { taxType: item.taxType } : {}),
        itemCode: item.itemCode,
      })),
    };

    if (date) {
      purchaseOrder.date = date;
    }
    if (deliveryDate) {
      purchaseOrder.deliveryDate = deliveryDate;
    }
    if (reference) {
      purchaseOrder.reference = reference;
    }
    if (currencyCode) {
      purchaseOrder.currencyCode = currencyCode as unknown as CurrencyCode;
    }

    const response = await xeroClient.accountingApi.createPurchaseOrders(
      xeroClient.tenantId,
      { purchaseOrders: [purchaseOrder] },
      undefined, // summarizeErrors
      undefined, // idempotencyKey
      getClientHeaders(),
    );

    const created = response.body.purchaseOrders?.[0];

    if (!created) {
      return {
        result: null,
        isError: true,
        error: "Failed to create purchase order.",
      };
    }

    return {
      result: created,
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
