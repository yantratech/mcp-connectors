import { xeroClient } from "../clients/xero-client.js";
import { RepeatingInvoice } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function getXeroRepeatingInvoice(
  repeatingInvoiceId: string,
): Promise<XeroClientResponse<RepeatingInvoice>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getRepeatingInvoice(
      xeroClient.tenantId,
      repeatingInvoiceId,
      getClientHeaders(),
    );

    const invoice = response.body.repeatingInvoices?.[0];

    if (!invoice) {
      return {
        result: null,
        isError: true,
        error: "Repeating invoice not found.",
      };
    }

    return {
      result: invoice,
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
