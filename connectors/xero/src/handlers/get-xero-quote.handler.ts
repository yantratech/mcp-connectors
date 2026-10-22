import { xeroClient } from "../clients/xero-client.js";
import { Quote } from "xero-node";

import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function getXeroQuote(
  quoteId: string,
): Promise<XeroClientResponse<Quote>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getQuote(
      xeroClient.tenantId,
      quoteId,
    );

    const quote = response.body.quotes?.[0];

    if (!quote) {
      return {
        result: null,
        isError: true,
        error: "Quote not found.",
      };
    }

    return {
      result: quote,
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
