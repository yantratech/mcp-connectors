import { xeroClient } from "../clients/xero-client.js";
import { LineAmountTypes, Receipt } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

interface LineItemInput {
  description: string;
  quantity: number;
  unitAmount: number;
  accountCode: string;
  taxType: string;
}

export async function createXeroReceipt(
  contactId: string,
  userId: string,
  lineItems: LineItemInput[],
  date?: string,
  reference?: string,
): Promise<XeroClientResponse<Receipt>> {
  try {
    await xeroClient.authenticate();

    const receipt: Receipt = {
      contact: { contactID: contactId },
      user: { userID: userId },
      lineItems: lineItems.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitAmount: item.unitAmount,
        accountCode: item.accountCode,
        taxType: item.taxType,
      })),
      lineAmountTypes: LineAmountTypes.Exclusive,
      status: Receipt.StatusEnum.DRAFT,
    };

    if (date) {
      receipt.date = date;
    }
    if (reference) {
      receipt.reference = reference;
    }

    const response = await xeroClient.accountingApi.createReceipt(
      xeroClient.tenantId,
      { receipts: [receipt] },
      undefined, // unitdp
      undefined, // idempotencyKey
      getClientHeaders(),
    );

    const created = response.body.receipts?.[0];

    if (!created) {
      return {
        result: null,
        isError: true,
        error: "Failed to create receipt.",
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
