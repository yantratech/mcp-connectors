import { xeroClient } from "../clients/xero-client.js";
import { Budget } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function getXeroBudget(
  budgetId: string,
  dateTo?: string,
  dateFrom?: string,
): Promise<XeroClientResponse<Budget>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getBudget(
      xeroClient.tenantId,
      budgetId,
      dateTo,
      dateFrom,
      getClientHeaders(),
    );

    const budget = response.body.budgets?.[0];

    if (!budget) {
      return {
        result: null,
        isError: true,
        error: "Budget not found.",
      };
    }

    return {
      result: budget,
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
