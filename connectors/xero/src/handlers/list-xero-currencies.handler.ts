import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { Currency } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";

async function listCurrencies(): Promise<Currency[]> {
  await xeroClient.authenticate();

  const response = await xeroClient.accountingApi.getCurrencies(
    xeroClient.tenantId,
    undefined, // where
    undefined, // order
    getClientHeaders(),
  );

  const currencies = response.body.currencies ?? [];
  return currencies;
}

/**
 * List all currencies from Xero
 */
export async function listXeroCurrencies(): Promise<
  XeroClientResponse<Currency[]>
> {
  try {
    const currencies = await listCurrencies();

    return {
      result: currencies,
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
