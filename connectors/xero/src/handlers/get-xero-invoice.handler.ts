import { xeroClient } from "../clients/xero-client.js";
import { Invoice } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function getXeroInvoice(
  invoiceId: string,
): Promise<XeroClientResponse<Invoice>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getInvoice(
      xeroClient.tenantId,
      invoiceId,
      undefined, // unitdp
      getClientHeaders(),
    );

    const invoice = response.body.invoices?.[0];

    if (!invoice) {
      return {
        result: null,
        isError: true,
        error: "Invoice not found.",
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
