import { listXeroContacts } from "../../handlers/list-xero-contacts.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { Contact } from "xero-node";
import { z } from "zod";

export function formatContact(contact: Contact): string {
  return [
    `Contact: ${contact.name}`,
    `ID: ${contact.contactID}`,
    contact.firstName ? `First Name: ${contact.firstName}` : null,
    contact.lastName ? `Last Name: ${contact.lastName}` : null,
    contact.accountNumber ? `Account Number: ${contact.accountNumber}` : null,
    contact.emailAddress ? `Email: ${contact.emailAddress}` : "No email",
    contact.accountsReceivableTaxType
      ? `AR Tax Type: ${contact.accountsReceivableTaxType}`
      : null,
    contact.accountsPayableTaxType
      ? `AP Tax Type: ${contact.accountsPayableTaxType}`
      : null,
    contact.phones && contact.phones.length > 0
      ? `Phones: ${contact.phones
          .filter((p) => p.phoneNumber)
          .map((p) => `${p.phoneType}: ${p.phoneNumber}`)
          .join(", ")}`
      : null,
    contact.addresses && contact.addresses.length > 0
      ? `Addresses: ${contact.addresses
          .filter((a) => a.addressLine1 || a.city)
          .map(
            (a) =>
              `${a.addressType}: ${[a.addressLine1, a.city, a.region, a.postalCode, a.country]
                .filter(Boolean)
                .join(", ")}`,
          )
          .join("; ")}`
      : null,
    `Type: ${
      [
        contact.isCustomer ? "Customer" : null,
        contact.isSupplier ? "Supplier" : null,
      ]
        .filter(Boolean)
        .join(", ") ||
      // Both flags false is a definite Xero answer, not missing data: Xero
      // sets Customer/Supplier only from invoices/bills, so contacts used
      // only on bank transactions (or with no activity) land here.
      "Not yet classified (Xero sets Customer/Supplier only from invoices/bills — contacts paid via bank transactions show this)"
    }`,
    contact.defaultCurrency
      ? `Default Currency: ${contact.defaultCurrency}`
      : null,
    contact.updatedDateUTC ? `Last Updated: ${contact.updatedDateUTC}` : null,
    `Status: ${contact.contactStatus || "Unknown"}`,
    contact.contactGroups?.length
      ? `Groups: ${contact.contactGroups.map((g) => g.name).join(", ")}`
      : null,
    contact.hasAttachments ? "Has Attachments: Yes" : null,
    contact.hasValidationErrors ? "Has Validation Errors: Yes" : null,
  ]
    .filter(Boolean)
    .join("\n");
}

const ListContactsTool = CreateXeroTool(
  "list_contacts",
  "List contacts in Xero (customers, suppliers, and contacts not yet classified), \
  up to 100 per page. ARCHIVED contacts are excluded by default (their count is \
  reported in the header; pass includeArchived: true to view them — archived rows \
  are identifiable by their Status line). \
  Note: Xero marks a contact Customer/Supplier only once it appears on an \
  invoice/bill, so suppliers paid solely via bank transactions show \
  'Type: Not yet classified'. \
  The header reports 'page N of M; T total' from Xero's pagination metadata — \
  trust it over counting returned rows, and call again with the next page number \
  (and the same filters) to paginate.",
  {
    page: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe(
        "Page number, 1-based (up to 100 contacts per page). Defaults to 1.",
      ),
    searchTerm: z.string().optional().describe("Search parameter that performs a case-insensitive text search across the Name, FirstName, LastName, ContactNumber and EmailAddress fields"),
    accountNumber: z.string().trim().min(1, "accountNumber cannot be empty").optional().describe(
      "Filter contacts by exact AccountNumber match (e.g. 'ACME-001'). \
      Server-side filter via Xero's where clause; combinable with searchTerm.",
    ),
    includeArchived: z
      .boolean()
      .optional()
      .describe(
        "Include ARCHIVED contacts (excluded by default). Archived rows are identifiable by their Status line.",
      ),
  },
  async (params) => {
    const { page, searchTerm, accountNumber, includeArchived } = params;
    const response = await listXeroContacts(
      page,
      searchTerm,
      accountNumber,
      includeArchived,
    );

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing contacts: ${response.error}`,
          },
        ],
      };
    }

    const { contacts, pagination, excludedArchived } = response.result;

    const headerParts: string[] = [];
    headerParts.push(
      pagination?.pageCount !== undefined && pagination?.itemCount !== undefined
        ? `Found ${contacts.length} contacts (page ${page} of ${pagination.pageCount}; ${pagination.itemCount} total matching${includeArchived ? ", including ARCHIVED" : ""}).`
        : `Found ${contacts.length} contacts (page ${page}; up to 100 per page — if 100 were returned, more pages may exist).`,
    );
    if (!includeArchived) {
      headerParts.push(
        excludedArchived !== undefined
          ? `Excluded by default: ${excludedArchived} ARCHIVED contacts — pass includeArchived: true to view them.`
          : "ARCHIVED contacts are excluded by default (count reported on page 1) — pass includeArchived: true to view them.",
      );
    }

    return {
      content: [
        {
          type: "text" as const,
          text: headerParts.join("\n"),
        },
        ...contacts.map((contact) => ({
          type: "text" as const,
          text: formatContact(contact),
        })),
      ],
    };
  },
);

export default ListContactsTool;
