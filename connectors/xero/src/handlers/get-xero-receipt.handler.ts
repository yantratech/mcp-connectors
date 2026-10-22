import { xeroClient } from "../clients/xero-client.js";
import { Receipt } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function getXeroReceipt(
  receiptId: string,
): Promise<XeroClientResponse<Receipt>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getReceipt(
      xeroClient.tenantId,
      receiptId,
      undefined, // unitdp
      getClientHeaders(),
    );

    const receipt = response.body.receipts?.[0];

    if (!receipt) {
      return {
        result: null,
        isError: true,
        error: "Receipt not found.",
      };
    }

    return {
      result: receipt,
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
