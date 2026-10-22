import { z } from "zod";
import { getXeroContact } from "../../handlers/get-xero-contact.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { Contact } from "xero-node";

export function formatContactDetails(c: Contact): string {
  return [
    "Contact details:",
    `Contact ID: ${c.contactID}`,
    c.name ? `Name: ${c.name}` : null,
    c.firstName ? `First Name: ${c.firstName}` : null,
    c.lastName ? `Last Name: ${c.lastName}` : null,
    c.accountNumber ? `Account Number: ${c.accountNumber}` : null,
    c.emailAddress ? `Email: ${c.emailAddress}` : null,
    c.contactStatus ? `Status: ${c.contactStatus}` : null,
    c.isSupplier !== undefined
      ? `Is Supplier: ${c.isSupplier}`
      : null,
    c.isCustomer !== undefined
      ? `Is Customer: ${c.isCustomer}`
      : null,
    c.phones && c.phones.length > 0
      ? `Phones: ${c.phones.filter((p) => p.phoneNumber).map((p) => `${p.phoneType}: ${p.phoneNumber}`).join(", ")}`
      : null,
    c.addresses && c.addresses.length > 0
      ? `Addresses: ${c.addresses.filter((a) => a.addressLine1 || a.city).map((a) => `${a.addressType}: ${[a.addressLine1, a.city, a.region, a.postalCode, a.country].filter(Boolean).join(", ")}`).join("; ")}`
      : null,
    c.accountsReceivableTaxType
      ? `AR Tax Type: ${c.accountsReceivableTaxType}`
      : null,
    c.accountsPayableTaxType
      ? `AP Tax Type: ${c.accountsPayableTaxType}`
      : null,
    // Xero returns outstanding/overdue balances on the contact record;
    // zeros are rendered too (a definite answer, not missing data).
    c.balances?.accountsReceivable || c.balances?.accountsPayable
      ? [
          "Balances (organisation base currency — see list_organisation_details):",
          c.balances.accountsReceivable
            ? `  AR Outstanding: ${c.balances.accountsReceivable.outstanding ?? 0} (Overdue: ${c.balances.accountsReceivable.overdue ?? 0})`
            : null,
          c.balances.accountsPayable
            ? `  AP Outstanding: ${c.balances.accountsPayable.outstanding ?? 0} (Overdue: ${c.balances.accountsPayable.overdue ?? 0})`
            : null,
        ]
          .filter(Boolean)
          .join("\n")
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

const GetContactTool = CreateXeroTool(
  "get_contact",
  "Get a specific contact by ID from Xero. \
  Use this to see full details including addresses, phones, tax types, and \
  outstanding/overdue AR and AP balances (in the organisation's base currency).",
  {
    contactId: z
      .string()
      .describe(
        "The ID of the contact to retrieve. Can be obtained from list_contacts.",
      ),
  },
  async ({ contactId }) => {
    const response = await getXeroContact(contactId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting contact: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: formatContactDetails(response.result),
        },
      ],
    };
  },
);

export default GetContactTool;
