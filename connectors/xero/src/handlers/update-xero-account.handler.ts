import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { Account, Accounts, AccountType } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";

async function updateAccount(
  accountID: string,
  name?: string,
  code?: string,
  type?: string,
  taxType?: string,
  description?: string,
  enablePaymentsToAccount?: boolean,
): Promise<Account | undefined> {
  await xeroClient.authenticate();

  const account: Account = {};

  if (name !== undefined) account.name = name;
  if (code !== undefined) account.code = code;
  if (type !== undefined) account.type = type as unknown as AccountType;
  if (taxType !== undefined) account.taxType = taxType;
  if (description !== undefined) account.description = description;
  if (enablePaymentsToAccount !== undefined) account.enablePaymentsToAccount = enablePaymentsToAccount;

  const accounts: Accounts = {
    accounts: [account],
  };

  const response = await xeroClient.accountingApi.updateAccount(
    xeroClient.tenantId,
    accountID,
    accounts,
    undefined, // idempotencyKey
    getClientHeaders(),
  );

  return response.body.accounts?.[0];
}

/**
 * Update an existing account in Xero
 */
export async function updateXeroAccount(
  accountID: string,
  name?: string,
  code?: string,
  type?: string,
  taxType?: string,
  description?: string,
  enablePaymentsToAccount?: boolean,
): Promise<XeroClientResponse<Account>> {
  try {
    const updatedAccount = await updateAccount(
      accountID,
      name,
      code,
      type,
      taxType,
      description,
      enablePaymentsToAccount,
    );

    if (!updatedAccount) {
      throw new Error("Account update failed.");
    }

    return {
      result: updatedAccount,
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
