import { z } from "zod";
import { updateXeroInvoice } from "../../handlers/update-xero-invoice.handler.js";
import { DeepLinkType, getDeepLink } from "../../helpers/get-deeplink.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { Invoice } from "xero-node";

const trackingSchema = z.object({
  name: z.string().describe("The name of the tracking category. Can be obtained from the list_tracking_categories tool"),
  option: z.string().describe("The name of the tracking option. Can be obtained from the list_tracking_categories tool"),
  trackingCategoryID: z.string().describe("The ID of the tracking category. \
    Can be obtained from the list_tracking_categories tool"),
});

const lineItemSchema = z.object({
  description: z.string().describe("The description of the line item"),
  quantity: z.number().describe("The quantity of the line item"),
  unitAmount: z.number().describe("The price per unit of the line item"),
  accountCode: z.string().describe("The account code of the line item - can be obtained from the list_accounts tool"),
  taxType: z.string().describe("The tax type of the line item - can be obtained from the list_tax_rates tool"),
  itemCode: z.string().describe("The item code of the line item - can be obtained from the list_items tool \
    If the item was not populated in the original invoice, \
    add without an item code unless the user has told you to add an item code.").optional(),
  tracking: z.array(trackingSchema).describe("Up to 2 tracking categories and options can be added to the line item. \
    Can be obtained from the list_tracking_categories tool. \
    Only use if prompted by the user.").optional(),
});

const UpdateInvoiceTool = CreateXeroTool(
  "update_invoice",
  "Update an invoice in Xero. Only works on draft invoices.\
  All line items must be provided. Any line items not provided will be removed. Including existing line items.\
  Do not modify line items that have not been specified by the user.\
 When an invoice is updated, a deep link to the invoice in Xero is returned. \
 This deep link can be used to view the contact in Xero directly. \
 This link should be displayed to the user.",
  {
    invoiceId: z.string().describe("The ID of the invoice to update."),
    lineItems: z.array(lineItemSchema).optional().describe(
      "All line items must be provided. Any line items not provided will be removed. Including existing line items. \
      Do not modify line items that have not been specified by the user",
    ),
    reference: z.string().optional().describe("A reference number for the invoice."),
    dueDate: z.string().optional().describe("The due date of the invoice."),
    date: z.string().optional().describe("The date of the invoice."),
    contactId: z.string().optional().describe("The ID of the contact to update the invoice for. \
      Can be obtained from the list_contacts tool."),
    invoiceNumber: z.string().trim().min(1, "invoiceNumber cannot be empty").optional().describe(
      "Custom invoice number to set on the invoice. \
      ACCREC (customer invoices) only — updating invoiceNumber on a bill (ACCPAY) is not supported. \
      If omitted, the existing invoice number is preserved. Xero will reject duplicates with its own error.",
    ),
  },
  async (
    {
      invoiceId,
      lineItems,
      reference,
      dueDate,
      date,
      contactId,
      invoiceNumber,
    }: {
      invoiceId: string;
      lineItems?: Array<{
        description: string;
        quantity: number;
        unitAmount: number;
        accountCode: string;
        taxType: string;
      }>;
      reference?: string;
      dueDate?: string;
      date?: string;
      contactId?: string;
      invoiceNumber?: string;
    },
    //_extra: { signal: AbortSignal },
  ) => {
    const result = await updateXeroInvoice(
      invoiceId,
      lineItems,
      reference,
      dueDate,
      date,
      contactId,
      invoiceNumber,
    );
    if (result.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error updating invoice: ${result.error}`,
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
            "Invoice updated successfully:",
            `ID: ${invoice?.invoiceID}`,
            invoice?.invoiceNumber ? `Invoice Number: ${invoice.invoiceNumber}` : null,
            `Contact: ${invoice?.contact?.name}`,
            `Type: ${invoice?.type}`,
            `Total: ${invoice?.total}`,
            `Status: ${invoice?.status}`,
            deepLink ? `Link to view: ${deepLink}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
  // Xero replaces line items on PUT — any existing line not in the payload is
  // dropped. The tool description warns about this; the annotation now does
  // too so clients can gate.
  { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
);

export default UpdateInvoiceTool;
