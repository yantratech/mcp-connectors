import { xeroClient } from "../clients/xero-client.js";
import { BankTransaction } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function getXeroBankTransaction(
  bankTransactionId: string,
): Promise<XeroClientResponse<BankTransaction>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getBankTransaction(
      xeroClient.tenantId,
      bankTransactionId,
      undefined, // unitdp
      getClientHeaders(),
    );

    const bankTransaction = response.body.bankTransactions?.[0];

    if (!bankTransaction) {
      return {
        result: null,
        isError: true,
        error: "Bank transaction not found.",
      };
    }

    return {
      result: bankTransaction,
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
