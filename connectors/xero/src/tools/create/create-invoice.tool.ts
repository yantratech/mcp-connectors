import { z } from "zod";
import { createXeroInvoice } from "../../handlers/create-xero-invoice.handler.js";
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
    If the item is not listed, add without an item code and ask the user if they would like to add an item code.").optional(),
  tracking: z.array(trackingSchema).describe("Up to 2 tracking categories and options can be added to the line item. \
    Can be obtained from the list_tracking_categories tool. \
    Only use if prompted by the user.").optional(),
});

const CreateInvoiceTool = CreateXeroTool(
  "create_invoice",
  "Create an invoice in Xero.\
 When an invoice is created, a deep link to the invoice in Xero is returned. \
 This deep link can be used to view the invoice in Xero directly. \
 This link should be displayed to the user.",
  {
    contactId: z.string().describe("The ID of the contact to create the invoice for. \
      Can be obtained from the list_contacts tool."),
      
    lineItems: z.array(lineItemSchema),
    type: z.enum(["ACCREC", "ACCPAY"]).describe("The type of invoice to create. \
      ACCREC is for sales invoices, Accounts Receivable, or customer invoices. \
      ACCPAY is for purchase invoices, Accounts Payable invoices, supplier invoices, or bills. \
      If the type is not specified, the default is ACCREC."),
    reference: z.string().describe("A reference number for the invoice.").optional(),
    date: z.string().describe("The date the invoice was created (YYYY-MM-DD format).").optional(),
    currencyCode: z.string().describe("ISO 4217 currency code (e.g. USD, GBP, EUR). Defaults to the contact's currency if omitted.").optional(),
    invoiceNumber: z.string().trim().min(1, "invoiceNumber cannot be empty").optional().describe(
      "Custom invoice number (e.g. 'INV-ACME-001'). \
      ACCREC (customer invoices) only — for ACCPAY (bills), set the supplier's invoice number via 'reference' instead. \
      If omitted, Xero auto-assigns the next number from the org's sequence. \
      Xero will reject duplicates with its own error.",
    ),
  },
  async ({ contactId, lineItems, type, reference, date, currencyCode, invoiceNumber }) => {
    const xeroInvoiceType = type === "ACCREC" ? Invoice.TypeEnum.ACCREC : Invoice.TypeEnum.ACCPAY;
    if (invoiceNumber !== undefined && xeroInvoiceType === Invoice.TypeEnum.ACCPAY) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Error creating invoice: invoiceNumber is only supported on ACCREC (customer invoices). For ACCPAY (bills), pass the supplier's invoice number via 'reference'.",
          },
        ],
      };
    }
    const result = await createXeroInvoice(contactId, lineItems, xeroInvoiceType, reference, date, currencyCode, invoiceNumber);
    if (result.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error creating invoice: ${result.error}`,
          },
        ],
      };
    }

    const invoice = result.result;

    // The invoice is already created at this point. Building the deep link
    // requires a second Xero call (org short code) that can fail; if it
    // throws here the model never learns the invoice was created and may
    // retry, creating a duplicate. Swallow the deep-link failure instead.
    let deepLink: string | null = null;
    if (invoice.invoiceID) {
      try {
        deepLink = await getDeepLink(
          invoice.type === Invoice.TypeEnum.ACCREC ? DeepLinkType.INVOICE : DeepLinkType.BILL,
          invoice.invoiceID,
        );
      } catch {
        deepLink = null;
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Invoice created successfully:",
            `ID: ${invoice?.invoiceID}`,
            invoice?.invoiceNumber ? `Invoice Number: ${invoice.invoiceNumber}` : null,
            `Contact: ${invoice?.contact?.name}`,
            `Type: ${invoice?.type}`,
            `Date: ${invoice?.date}`,
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
);

export default CreateInvoiceTool;
