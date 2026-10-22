import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { Contact, Phone, Address, Contacts } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import {
  ContactAddressInput,
  ContactPhoneInput,
} from "./create-xero-contact.handler.js";

interface LegacyAddressInput {
  addressLine1: string;
  addressLine2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}

// xero-node's AddressTypeEnum is a string enum missing the DELIVERY variant the
// Xero Contacts API supports, so we pass the literal through as the enum type
// at the wire level it's just a string.
function mapAddresses(
  addresses: ContactAddressInput[] | undefined,
  legacyAddress: LegacyAddressInput | undefined,
): Address[] | undefined {
  if (addresses?.length) {
    return addresses.map((a) => ({
      addressType: a.addressType as unknown as Address.AddressTypeEnum,
      addressLine1: a.addressLine1,
      addressLine2: a.addressLine2,
      addressLine3: a.addressLine3,
      addressLine4: a.addressLine4,
      city: a.city,
      region: a.region,
      postalCode: a.postalCode,
      country: a.country,
      attentionTo: a.attentionTo,
    }));
  }
  if (legacyAddress) {
    return [
      {
        addressType: Address.AddressTypeEnum.STREET,
        addressLine1: legacyAddress.addressLine1,
        addressLine2: legacyAddress.addressLine2,
        city: legacyAddress.city,
        country: legacyAddress.country,
        postalCode: legacyAddress.postalCode,
        region: legacyAddress.region,
      },
    ];
  }
  return undefined;
}

function mapPhones(
  phones: ContactPhoneInput[] | undefined,
  legacyPhone: string | undefined,
): Phone[] | undefined {
  if (phones?.length) {
    return phones.map((p) => ({
      phoneType: Phone.PhoneTypeEnum[p.phoneType] as Phone.PhoneTypeEnum,
      phoneNumber: p.phoneNumber,
      phoneAreaCode: p.phoneAreaCode,
      phoneCountryCode: p.phoneCountryCode,
    }));
  }
  if (legacyPhone) {
    return [
      {
        phoneNumber: legacyPhone,
        phoneType: Phone.PhoneTypeEnum.MOBILE,
      },
    ];
  }
  return undefined;
}

async function updateContact(
  name: string,
  firstName: string | undefined,
  lastName: string | undefined,
  email: string | undefined,
  phone: string | undefined,
  legacyAddress: LegacyAddressInput | undefined,
  contactId: string,
  accountNumber: string | undefined,
  addresses: ContactAddressInput[] | undefined,
  phones: ContactPhoneInput[] | undefined,
): Promise<Contact | undefined> {
  await xeroClient.authenticate();

  // Xero PUT treats absent fields as no-change; only include arrays when the
  // caller supplied data, so omitting `addresses` doesn't wipe `phones` and
  // vice versa.
  const contact: Contact = {
    name,
    firstName,
    lastName,
    emailAddress: email,
    ...(accountNumber !== undefined ? { accountNumber } : {}),
    phones: mapPhones(phones, phone),
    addresses: mapAddresses(addresses, legacyAddress),
  };

  const contacts: Contacts = {
    contacts: [contact],
  };

  const response = await xeroClient.accountingApi.updateContact(
    xeroClient.tenantId,
    contactId, // contactId
    contacts, // contacts
    undefined, // idempotencyKey
    getClientHeaders(),
  );

  const updatedContact = response.body.contacts?.[0];
  return updatedContact;
}

/**
 * Create a new invoice in Xero
 */
export async function updateXeroContact(
  contactId: string,
  name: string,
  firstName?: string,
  lastName?: string,
  email?: string,
  phone?: string,
  legacyAddress?: LegacyAddressInput,
  accountNumber?: string,
  addresses?: ContactAddressInput[],
  phones?: ContactPhoneInput[],
): Promise<XeroClientResponse<Contact>> {
  try {
    const updatedContact = await updateContact(
      name,
      firstName,
      lastName,
      email,
      phone,
      legacyAddress,
      contactId,
      accountNumber,
      addresses,
      phones,
    );

    if (!updatedContact) {
      throw new Error("Contact update failed.");
    }

    return {
      result: updatedContact,
      isError: false,
      error: null,
    };
  } catch (error) {
    return {
      result: null,
      isError: true,
      error: formatError(error),
    };
  }
}
