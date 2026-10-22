import { z } from "zod";
import { batchCreateXeroContacts } from "../../handlers/batch-create-xero-contacts.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const contactSchema = z.object({
  name: z.string().describe("The name of the contact (company or person)."),
  emailAddress: z
    .string()
    .optional()
    .describe("The email address of the contact."),
  firstName: z
    .string()
    .optional()
    .describe("The first name of the contact."),
  lastName: z
    .string()
    .optional()
    .describe("The last name of the contact."),
  phone: z
    .string()
    .optional()
    .describe("The phone number of the contact."),
  accountNumber: z
    .string()
    .optional()
    .describe("A unique account number for the contact."),
  taxNumber: z
    .string()
    .optional()
    .describe("The tax number (VAT number) of the contact."),
});

const BatchCreateContactsTool = CreateXeroTool(
  "batch_create_contacts",
  "Create multiple contacts in a single API call. \
  This is much more efficient than creating contacts one at a time. \
  If a contact with the same name already exists, it will be updated instead. \
  Supports up to 50 contacts per batch.",
  {
    contacts: z
      .array(contactSchema)
      .describe("An array of contacts to create (max 50)."),
    summarizeErrors: z
      .boolean()
      .optional()
      .describe(
        "If true, only returns a summary of errors (default). If false, returns full error details.",
      ),
  },
  async ({ contacts, summarizeErrors }) => {
    if (contacts.length > 50) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Error: Maximum 50 contacts per batch. Please split into smaller batches.",
          },
        ],
      };
    }

    const result = await batchCreateXeroContacts(
      contacts,
      summarizeErrors ?? true,
    );

    if (result.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error batch creating contacts: ${result.error}`,
          },
        ],
      };
    }

    const created = result.result;
    const hasErrors = created.some((c) => c.hasValidationErrors);

    return {
      content: [
        {
          type: "text" as const,
          text: `Batch created/updated ${created.length} contacts${hasErrors ? " (some had errors)" : ""}:`,
        },
        ...created.map((c) => ({
          type: "text" as const,
          text: [
            `Contact ID: ${c.contactID}`,
            `Name: ${c.name}`,
            c.emailAddress ? `Email: ${c.emailAddress}` : null,
            c.contactStatus ? `Status: ${c.contactStatus}` : null,
            c.hasValidationErrors ? "HAS ERRORS" : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })),
      ],
    };
  },
  // The handler calls updateOrCreateContacts — an UPSERT. If a contact with
  // a matching name already exists, its fields are overwritten (the schema
  // accepts no contactID). Flag destructive so clients gate the call.
  { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
);

export default BatchCreateContactsTool;
