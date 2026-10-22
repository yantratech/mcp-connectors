import { z } from "zod";

import { getXeroInvoiceOnlineUrl } from "../../handlers/get-xero-invoice-online-url.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetInvoiceOnlineUrlTool = CreateXeroTool(
  "get_invoice_online_url",
  "Get the shareable online invoice ('pay now') URL for a Xero sales invoice. \
  This is the policy-safe alternative to emailing invoices from Xero: retrieve the \
  link and let a human share it with the customer. \
  Only works for sales (ACCREC) invoices in a non-DRAFT status on organisations \
  with online invoicing enabled — Xero's error is surfaced verbatim otherwise.",
  {
    invoiceId: z
      .string()
      .describe("The ID of the sales (ACCREC) invoice to get the URL for."),
  },
  async ({ invoiceId }) => {
    const response = await getXeroInvoiceOnlineUrl(invoiceId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting online invoice URL: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Online invoice URL:",
            response.result.onlineInvoiceUrl,
          ].join("\n"),
        },
      ],
    };
  },
);

export default GetInvoiceOnlineUrlTool;
