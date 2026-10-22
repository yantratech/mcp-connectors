import { xeroClient } from "../clients/xero-client.js";
import { BankTransfer } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function getXeroBankTransfer(
  bankTransferId: string,
): Promise<XeroClientResponse<BankTransfer>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getBankTransfer(
      xeroClient.tenantId,
      bankTransferId,
      getClientHeaders(),
    );

    const bankTransfer = response.body.bankTransfers?.[0];

    if (!bankTransfer) {
      return {
        result: null,
        isError: true,
        error: "Bank transfer not found.",
      };
    }

    return {
      result: bankTransfer,
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
