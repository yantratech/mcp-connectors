import { xeroClient } from "../clients/xero-client.js";
import { CurrencyCode, Invoice } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

interface LineItemInput {
  description: string;
  quantity: number;
  unitAmount: number;
  accountCode: string;
  taxType?: string;
  itemCode?: string;
}

interface InvoiceInput {
  contactId: string;
  lineItems: LineItemInput[];
  type: "ACCREC" | "ACCPAY";
  reference?: string;
  date?: string;
  currencyCode?: string;
}

export async function batchCreateXeroInvoices(
  invoices: InvoiceInput[],
  summarizeErrors: boolean = true,
): Promise<XeroClientResponse<Invoice[]>> {
  try {
    await xeroClient.authenticate();

    const xeroInvoices: Invoice[] = invoices.map((inv) => ({
      type:
        inv.type === "ACCREC"
          ? Invoice.TypeEnum.ACCREC
          : Invoice.TypeEnum.ACCPAY,
      contact: { contactID: inv.contactId },
      lineItems: inv.lineItems.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitAmount: item.unitAmount,
        accountCode: item.accountCode,
        ...(item.taxType ? { taxType: item.taxType } : {}),
        itemCode: item.itemCode,
      })),
      reference: inv.reference,
      date: inv.date,
      ...(inv.currencyCode ? { currencyCode: inv.currencyCode as unknown as CurrencyCode } : {}),
    }));

    const response = await xeroClient.accountingApi.updateOrCreateInvoices(
      xeroClient.tenantId,
      { invoices: xeroInvoices },
      summarizeErrors,
      undefined, // unitdp
      undefined, // idempotencyKey
      undefined, // allowBackorders
      getClientHeaders(),
    );

    return {
      result: response.body.invoices ?? [],
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
