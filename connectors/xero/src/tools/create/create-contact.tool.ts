import { createXeroContact } from "../../handlers/create-xero-contact.handler.js";
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

const CreateContactTool = CreateXeroTool(
  "create_contact",
  "Create a contact in Xero.\
  When a contact is created, a deep link to the contact in Xero is returned. \
  This deep link can be used to view the contact in Xero directly. \
  This link should be displayed to the user.",
  {
    name: z.string(),
    email: z.string().email().optional(),
    phone: z
      .string()
      .optional()
      .describe(
        "Legacy single phone (treated as MOBILE). Ignored if `phones` array is provided.",
      ),
    accountNumber: z.string().trim().min(1, "accountNumber cannot be empty").optional().describe(
      "Customer account number / contact code (e.g. 'ACME-001'). \
      Stored on the Xero contact and shown in the contact list. \
      Xero will reject duplicates with its own error.",
    ),
    addresses: z
      .array(addressSchema)
      .optional()
      .describe(
        "Array of typed addresses. POBOX is what the Standard invoice PDF prints in the billing block, \
so customers expecting an address on their invoice need a POBOX entry. \
STREET and DELIVERY are also supported.",
      ),
    phones: z
      .array(phoneSchema)
      .optional()
      .describe(
        "Array of typed phones (DEFAULT / MOBILE / FAX / DDI). \
If provided, the legacy single `phone` parameter is ignored.",
      ),
  },
  async ({ name, email, phone, accountNumber, addresses, phones }) => {
    try {
      const response = await createXeroContact(name, email, phone, accountNumber, addresses, phones);
      if (response.isError) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error creating contact: ${response.error}`,
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
              `Contact created: ${contact.name} (ID: ${contact.contactID})`,
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
            text: `Error creating contact: ${err.message}`,
          },
        ],
      };
    }
  },
);

export default CreateContactTool;
