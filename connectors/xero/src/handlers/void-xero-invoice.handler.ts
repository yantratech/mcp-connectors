import { xeroClient } from "../clients/xero-client.js";
import { Invoice } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function voidXeroInvoice(
  invoiceId: string,
): Promise<XeroClientResponse<Invoice>> {
  try {
    await xeroClient.authenticate();

    const invoice: Invoice = {
      invoiceID: invoiceId,
      status: Invoice.StatusEnum.VOIDED,
    };

    const response = await xeroClient.accountingApi.updateInvoice(
      xeroClient.tenantId,
      invoiceId,
      { invoices: [invoice] },
      undefined, // unitdp
      undefined, // idempotencyKey
      undefined, // allowBackorders
      getClientHeaders(),
    );

    const updated = response.body.invoices?.[0];

    if (!updated) {
      return {
        result: null,
        isError: true,
        error: "Failed to void invoice.",
      };
    }

    return {
      result: updated,
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
