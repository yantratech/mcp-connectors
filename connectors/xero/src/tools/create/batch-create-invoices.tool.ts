import { z } from "zod";
import { batchCreateXeroInvoices } from "../../handlers/batch-create-xero-invoices.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const lineItemSchema = z.object({
  description: z.string().describe("The description of the line item"),
  quantity: z.number().describe("The quantity"),
  unitAmount: z.number().describe("The price per unit"),
  accountCode: z
    .string()
    .describe("The account code - from list_accounts"),
  taxType: z
    .string()
    .describe("The tax type - from list_tax_rates. If omitted, Xero uses the default for the account.")
    .optional(),
  itemCode: z
    .string()
    .describe("The item code - from list_items")
    .optional(),
});

const invoiceSchema = z.object({
  contactId: z
    .string()
    .describe("The contact ID - from list_contacts"),
  lineItems: z.array(lineItemSchema),
  type: z
    .enum(["ACCREC", "ACCPAY"])
    .describe("ACCREC for sales invoices, ACCPAY for bills."),
  reference: z.string().optional().describe("A reference for the invoice."),
  date: z
    .string()
    .optional()
    .describe("The invoice date (YYYY-MM-DD format)."),
  currencyCode: z
    .string()
    .optional()
    .describe("ISO 4217 currency code (e.g. USD, GBP, EUR). Defaults to the contact's currency if omitted."),
});

const BatchCreateInvoicesTool = CreateXeroTool(
  "batch_create_invoices",
  "Create multiple invoices in a single API call. \
  This is much more efficient than creating invoices one at a time. \
  Supports up to 50 invoices per batch. \
  All invoices will be created in DRAFT status.",
  {
    invoices: z
      .array(invoiceSchema)
      .describe("An array of invoices to create (max 50)."),
    summarizeErrors: z
      .boolean()
      .optional()
      .describe(
        "If true, only returns a summary of errors (default). If false, returns full error details per invoice.",
      ),
  },
  async ({ invoices, summarizeErrors }) => {
    if (invoices.length > 50) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Error: Maximum 50 invoices per batch. Please split into smaller batches.",
          },
        ],
      };
    }

    const result = await batchCreateXeroInvoices(
      invoices,
      summarizeErrors ?? true,
    );

    if (result.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error batch creating invoices: ${result.error}`,
          },
        ],
      };
    }

    const created = result.result;
    const hasErrors = created.some((inv) => inv.hasErrors);

    return {
      content: [
        {
          type: "text" as const,
          text: `Batch created ${created.length} invoices${hasErrors ? " (some had errors)" : ""}:`,
        },
        ...created.map((inv) => ({
          type: "text" as const,
          text: [
            `Invoice ID: ${inv.invoiceID}`,
            inv.invoiceNumber ? `Number: ${inv.invoiceNumber}` : null,
            `Type: ${inv.type}`,
            `Status: ${inv.status}`,
            inv.contact ? `Contact: ${inv.contact.name}` : null,
            inv.total !== undefined ? `Total: ${inv.total}` : null,
            inv.hasErrors ? "HAS ERRORS" : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })),
      ],
    };
  },
  // The handler calls updateOrCreateInvoices, but the schema accepts no
  // invoiceID or invoiceNumber, so every entry is created as a new DRAFT.
  // Flagged destructive anyway so clients gate a write of up to 50 invoices.
  { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
);

export default BatchCreateInvoicesTool;
