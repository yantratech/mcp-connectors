import { z } from "zod";
import { approveXeroInvoice } from "../../handlers/approve-xero-invoice.handler.js";
import { DeepLinkType, getDeepLink } from "../../helpers/get-deeplink.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { Invoice } from "xero-node";

const ApproveInvoiceTool = CreateXeroTool(
  "approve_invoice",
  "Approve a draft invoice or bill in Xero, changing its status from DRAFT to AUTHORISED. \
  Only works on DRAFT invoices. Once approved, invoices can be paid and will appear in reports.",
  {
    invoiceId: z
      .string()
      .describe(
        "The ID of the draft invoice to approve. Can be obtained from the list_invoices tool.",
      ),
  },
  async ({ invoiceId }) => {
    const result = await approveXeroInvoice(invoiceId);

    if (result.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error approving invoice: ${result.error}`,
          },
        ],
      };
    }

    const invoice = result.result;

    const deepLink = invoice.invoiceID
      ? await getDeepLink(
          invoice.type === Invoice.TypeEnum.ACCREC ? DeepLinkType.INVOICE : DeepLinkType.BILL,
          invoice.invoiceID,
        )
      : null;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Invoice approved successfully:",
            `Invoice ID: ${invoice.invoiceID}`,
            `Invoice Number: ${invoice.invoiceNumber}`,
            `Status: ${invoice.status}`,
            invoice.contact ? `Contact: ${invoice.contact.name}` : null,
            invoice.total !== undefined ? `Total: ${invoice.total}` : null,
            deepLink ? `Link to view: ${deepLink}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default ApproveInvoiceTool;
