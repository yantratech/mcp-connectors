import { xeroClient } from "../clients/xero-client.js";
import { Budget } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function listXeroBudgets(
  dateTo?: string,
  dateFrom?: string,
): Promise<XeroClientResponse<Budget[]>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getBudgets(
      xeroClient.tenantId,
      undefined, // iDs
      dateTo,
      dateFrom,
      getClientHeaders(),
    );

    return {
      result: response.body.budgets ?? [],
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
