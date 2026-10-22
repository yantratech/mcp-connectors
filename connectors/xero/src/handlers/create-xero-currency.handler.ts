import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { Currency, CurrencyCode } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";

async function createCurrency(
  code: string,
  description?: string,
): Promise<Currency | undefined> {
  await xeroClient.authenticate();

  const currency: Currency = {
    code: code as unknown as CurrencyCode,
    description,
  };

  const response = await xeroClient.accountingApi.createCurrency(
    xeroClient.tenantId,
    currency,
    undefined, // idempotencyKey
    getClientHeaders(),
  );

  return response.body.currencies?.[0];
}

/**
 * Create a new currency in Xero
 */
export async function createXeroCurrency(
  code: string,
  description?: string,
): Promise<XeroClientResponse<Currency>> {
  try {
    const createdCurrency = await createCurrency(code, description);

    if (!createdCurrency) {
      throw new Error("Currency creation failed.");
    }

    return {
      result: createdCurrency,
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
