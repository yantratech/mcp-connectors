import { xeroClient } from "../clients/xero-client.js";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { extractXeroResponse, formatError } from "../helpers/format-error.js";

export interface InvoiceOnlineUrl {
  onlineInvoiceUrl: string;
}

export async function getXeroInvoiceOnlineUrl(
  invoiceId: string,
): Promise<XeroClientResponse<InvoiceOnlineUrl>> {
  try {
    await xeroClient.authenticate();

    // Xero rejects this for DRAFT invoices, ACCPAY bills, and organisations
    // with online invoicing disabled — those SDK errors surface verbatim
    // through the catch path below.
    const response = await xeroClient.accountingApi.getOnlineInvoice(
      xeroClient.tenantId,
      invoiceId,
      getClientHeaders(),
    );

    const onlineInvoiceUrl =
      response.body.onlineInvoices?.[0]?.onlineInvoiceUrl;

    if (!onlineInvoiceUrl) {
      return {
        result: null,
        isError: true,
        error: `Xero returned no online invoice URL for invoice ${invoiceId}.`,
      };
    }

    return {
      result: { onlineInvoiceUrl },
      isError: false,
      error: null,
    };
  } catch (error) {
    const statusCode = extractXeroResponse(error)?.statusCode;
    if (statusCode === 404) {
      return {
        result: null,
        isError: true,
        error: `No online invoice URL available for invoice ${invoiceId}: Xero returns 404 for bills (ACCPAY), draft or deleted invoices, and organisations without online invoicing enabled.`,
      };
    }
    return {
      result: null,
      isError: true,
      error: formatError(error),
    };
  }
}
