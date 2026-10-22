import { xeroClient } from "../clients/xero-client.js";
import { Invoice } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function approveXeroInvoice(
  invoiceId: string,
): Promise<XeroClientResponse<Invoice>> {
  try {
    await xeroClient.authenticate();

    // Fetch the invoice to confirm it's in DRAFT status
    const getResponse = await xeroClient.accountingApi.getInvoice(
      xeroClient.tenantId,
      invoiceId,
      undefined, // unitdp
      getClientHeaders(),
    );

    const existingInvoice = getResponse.body.invoices?.[0];

    if (!existingInvoice) {
      return {
        result: null,
        isError: true,
        error: "Invoice not found.",
      };
    }

    if (existingInvoice.status !== Invoice.StatusEnum.DRAFT) {
      return {
        result: null,
        isError: true,
        error: `Cannot approve invoice because it is not a draft. Current status: ${existingInvoice.status}`,
      };
    }

    const invoice: Invoice = {
      invoiceID: invoiceId,
      status: Invoice.StatusEnum.AUTHORISED,
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
        error: "Failed to approve invoice.",
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
