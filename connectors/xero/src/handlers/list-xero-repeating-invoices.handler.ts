import { xeroClient } from "../clients/xero-client.js";
import { RepeatingInvoice } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function listXeroRepeatingInvoices(
  where?: string,
  order?: string,
): Promise<XeroClientResponse<RepeatingInvoice[]>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getRepeatingInvoices(
      xeroClient.tenantId,
      where,
      order || "RepeatingInvoiceID",
      getClientHeaders(),
    );

    return {
      result: response.body.repeatingInvoices ?? [],
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
