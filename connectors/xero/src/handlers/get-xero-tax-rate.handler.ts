import { xeroClient } from "../clients/xero-client.js";
import { TaxRate } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function getXeroTaxRate(
  taxType: string,
): Promise<XeroClientResponse<TaxRate>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getTaxRateByTaxType(
      xeroClient.tenantId,
      taxType,
      getClientHeaders(),
    );

    const taxRate = response.body.taxRates?.[0];

    if (!taxRate) {
      return {
        result: null,
        isError: true,
        error: `Tax rate with tax type ${taxType} not found.`,
      };
    }

    return {
      result: taxRate,
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
