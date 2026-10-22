import { xeroClient } from "../clients/xero-client.js";
import { Invoice } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function deleteXeroDraftInvoice(
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
        error: `Cannot delete invoice — only DRAFT invoices can be deleted. Current status: ${existingInvoice.status}. Use void_invoice for AUTHORISED invoices.`,
      };
    }

    const invoice: Invoice = {
      invoiceID: invoiceId,
      status: Invoice.StatusEnum.DELETED,
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

    const deleted = response.body.invoices?.[0];

    if (!deleted) {
      return {
        result: null,
        isError: true,
        error: "Failed to delete draft invoice.",
      };
    }

    return {
      result: deleted,
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
