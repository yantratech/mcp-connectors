import { updateXeroContact } from "../../handlers/update-xero-contact.handler.js";
import { z } from "zod";
import { DeepLinkType, getDeepLink } from "../../helpers/get-deeplink.js";
import { ensureError } from "../../helpers/ensure-error.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const addressSchema = z.object({
  addressType: z.enum(["POBOX", "STREET", "DELIVERY"]).describe(
    "POBOX is the postal/billing address (used by Xero's Standard invoice PDF template). \
STREET is the physical street address. DELIVERY is a separate delivery address.",
  ),
  addressLine1: z.string(),
  addressLine2: z.string().optional(),
  addressLine3: z.string().optional(),
  addressLine4: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  attentionTo: z.string().optional(),
});

const phoneSchema = z.object({
  phoneType: z.enum(["DEFAULT", "MOBILE", "FAX", "DDI"]),
  phoneNumber: z.string(),
  phoneAreaCode: z.string().optional(),
  phoneCountryCode: z.string().optional(),
});

const UpdateContactTool = CreateXeroTool(
  "update_contact",
  "Update a contact in Xero.\
 When a contact is updated, a deep link to the contact in Xero is returned. \
 This deep link can be used to view the contact in Xero directly. \
 This link should be displayed to the user. \
 Omitted fields are preserved by Xero (PUT semantics); to change phones only, \
 do not pass addresses, and vice versa.",
  {
    contactId: z.string(),
    name: z.string(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().email().optional(),
    phone: z
      .string()
      .optional()
      .describe(
        "Legacy single phone (treated as MOBILE). Ignored if `phones` array is provided.",
      ),
    address: z
      .object({
        addressLine1: z.string(),
        addressLine2: z.string().optional(),
        city: z.string().optional(),
        region: z.string().optional(),
        postalCode: z.string().optional(),
        country: z.string().optional(),
      })
      .optional()
      .describe(
        "Legacy single STREET address. Ignored if `addresses` array is provided.",
      ),
    accountNumber: z.string().trim().min(1, "accountNumber cannot be empty").optional().describe(
      "Customer account number / contact code (e.g. 'ACME-001'). \
      If omitted, the existing account number is preserved. \
      Xero will reject duplicates with its own error.",
    ),
    addresses: z
      .array(addressSchema)
      .optional()
      .describe(
        "Array of typed addresses (POBOX / STREET / DELIVERY). POBOX is what \
the Standard invoice PDF prints in the billing block.",
      ),
    phones: z
      .array(phoneSchema)
      .optional()
      .describe(
        "Array of typed phones (DEFAULT / MOBILE / FAX / DDI).",
      ),
  },
  async ({
    contactId,
    name,
    firstName,
    lastName,
    email,
    phone,
    address,
    accountNumber,
    addresses,
    phones,
  }) => {
    try {
      const response = await updateXeroContact(
        contactId,
        name,
        firstName,
        lastName,
        email,
        phone,
        address,
        accountNumber,
        addresses,
        phones,
      );
      if (response.isError) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error updating contact: ${response.error}`,
            },
          ],
        };
      }

      const contact = response.result;

      const deepLink = contact.contactID
        ? await getDeepLink(DeepLinkType.CONTACT, contact.contactID)
        : null;

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Contact updated: ${contact.name} (ID: ${contact.contactID})`,
              contact.accountNumber ? `Account Number: ${contact.accountNumber}` : null,
              deepLink ? `Link to view: ${deepLink}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      };
    } catch (error) {
      const err = ensureError(error);

      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error updating contact: ${err.message}`,
          },
        ],
      };
    }
  },
);

export default UpdateContactTool;
