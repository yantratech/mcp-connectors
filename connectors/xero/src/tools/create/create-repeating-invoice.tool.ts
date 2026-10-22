import { z } from "zod";
import { createXeroRepeatingInvoice } from "../../handlers/create-xero-repeating-invoice.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const lineItemSchema = z.object({
  description: z.string().describe("The description of the line item"),
  quantity: z.number().describe("The quantity of the line item"),
  unitAmount: z.number().describe("The price per unit of the line item"),
  accountCode: z
    .string()
    .describe(
      "The account code of the line item - can be obtained from the list_accounts tool",
    ),
  taxType: z
    .string()
    .describe(
      "The tax type of the line item - can be obtained from the list_tax_rates tool. If omitted, Xero uses the default for the account.",
    )
    .optional(),
  itemCode: z
    .string()
    .describe("The item code of the line item - can be obtained from the list_items tool")
    .optional(),
});

const scheduleSchema = z.object({
  period: z.number().describe("The number of units between repeats (e.g. 1 for every month, 2 for every 2 weeks)"),
  unit: z.enum(["WEEKLY", "MONTHLY"]).describe("The unit of the repeat period"),
  dueDate: z.number().describe("The number of days for the due date. Meaning depends on dueDateType."),
  dueDateType: z
    .enum([
      "DAYSAFTERBILLDATE",
      "DAYSAFTERBILLMONTH",
      "OFCURRENTMONTH",
      "OFFOLLOWINGMONTH",
    ])
    .describe(
      "How the due date is calculated. DAYSAFTERBILLDATE = X days after invoice date. DAYSAFTERBILLMONTH = X days after end of invoice month. OFCURRENTMONTH = Xth day of current month. OFFOLLOWINGMONTH = Xth day of following month.",
    ),
  startDate: z
    .string()
    .describe("The start date for the repeating schedule (YYYY-MM-DD format)"),
  endDate: z
    .string()
    .describe("Optional end date for the repeating schedule (YYYY-MM-DD format)")
    .optional(),
});

const CreateRepeatingInvoiceTool = CreateXeroTool(
  "create_repeating_invoice",
  "Create a repeating (recurring) invoice in Xero. \
  This creates a template that will auto-generate invoices on a schedule. \
  Supports both sales invoices (ACCREC) and bills (ACCPAY).",
  {
    contactId: z
      .string()
      .describe(
        "The ID of the contact. Can be obtained from the list_contacts tool.",
      ),
    lineItems: z.array(lineItemSchema),
    type: z
      .enum(["ACCREC", "ACCPAY"])
      .describe(
        "ACCREC for sales invoices, ACCPAY for bills/purchase invoices.",
      ),
    schedule: scheduleSchema,
    reference: z
      .string()
      .describe("An optional reference for the repeating invoice.")
      .optional(),
    status: z
      .enum(["DRAFT", "AUTHORISED"])
      .describe("Status of the repeating invoice. Default is DRAFT.")
      .optional(),
    currencyCode: z
      .string()
      .describe("ISO 4217 currency code (e.g. USD, GBP, EUR). Defaults to the contact's currency if omitted.")
      .optional(),
  },
  async ({ contactId, lineItems, type, schedule, reference, status, currencyCode }) => {
    const result = await createXeroRepeatingInvoice(
      contactId,
      lineItems,
      type,
      schedule,
      reference,
      status,
      currencyCode,
    );

    if (result.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error creating repeating invoice: ${result.error}`,
          },
        ],
      };
    }

    const invoice = result.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Repeating invoice created successfully:",
            `ID: ${invoice.repeatingInvoiceID}`,
            `Type: ${invoice.type}`,
            `Status: ${invoice.status}`,
            invoice.contact ? `Contact: ${invoice.contact.name}` : null,
            invoice.schedule
              ? `Schedule: Every ${invoice.schedule.period} ${invoice.schedule.unit}`
              : null,
            invoice.total !== undefined ? `Total: ${invoice.total}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default CreateRepeatingInvoiceTool;
