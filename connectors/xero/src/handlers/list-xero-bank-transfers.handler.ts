import { xeroClient } from "../clients/xero-client.js";
import { BankTransfer } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

async function getBankTransfers(): Promise<BankTransfer[]> {
  await xeroClient.authenticate();

  const response = await xeroClient.accountingApi.getBankTransfers(
    xeroClient.tenantId,
    undefined, // ifModifiedSince
    undefined, // where
    "Date DESC", // order
    undefined, // includeDeleted
    getClientHeaders(),
  );

  return response.body.bankTransfers ?? [];
}

export async function listXeroBankTransfers(): Promise<XeroClientResponse<BankTransfer[]>> {
  try {
    const bankTransfers = await getBankTransfers();

    return {
      result: bankTransfers,
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
