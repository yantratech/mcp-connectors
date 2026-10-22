import { xeroClient } from "../clients/xero-client.js";
import { Account } from "xero-node";

import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function getXeroAccount(
  accountId: string,
): Promise<XeroClientResponse<Account>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getAccount(
      xeroClient.tenantId,
      accountId,
    );

    const account = response.body.accounts?.[0];

    if (!account) {
      return {
        result: null,
        isError: true,
        error: "Account not found.",
      };
    }

    return {
      result: account,
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
