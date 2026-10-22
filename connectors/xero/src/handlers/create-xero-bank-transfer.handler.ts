import { xeroClient } from "../clients/xero-client.js";
import { BankTransfer } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function createXeroBankTransfer(
  fromBankAccountId: string,
  toBankAccountId: string,
  amount: number,
  date?: string,
  reference?: string,
): Promise<XeroClientResponse<BankTransfer>> {
  try {
    await xeroClient.authenticate();

    const bankTransfer: BankTransfer = {
      fromBankAccount: { accountID: fromBankAccountId },
      toBankAccount: { accountID: toBankAccountId },
      amount: amount,
    };

    if (date) {
      bankTransfer.date = date;
    }

    if (reference) {
      bankTransfer.reference = reference;
    }

    const response = await xeroClient.accountingApi.createBankTransfer(
      xeroClient.tenantId,
      { bankTransfers: [bankTransfer] },
      undefined, // idempotencyKey
      getClientHeaders(),
    );

    const created = response.body.bankTransfers?.[0];

    if (!created) {
      return {
        result: null,
        isError: true,
        error: "Failed to create bank transfer.",
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
