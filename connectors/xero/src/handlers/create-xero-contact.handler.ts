import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { Address, Contact, Phone } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";

export interface ContactAddressInput {
  addressType: "POBOX" | "STREET" | "DELIVERY";
  addressLine1: string;
  addressLine2?: string;
  addressLine3?: string;
  addressLine4?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  attentionTo?: string;
}

export interface ContactPhoneInput {
  phoneType: "DEFAULT" | "MOBILE" | "FAX" | "DDI";
  phoneNumber: string;
  phoneAreaCode?: string;
  phoneCountryCode?: string;
}

// xero-node's AddressTypeEnum is a string enum missing the DELIVERY variant the
// Xero Contacts API supports, so we pass the literal through as the enum type
// at the wire level it's just a string.
function mapAddresses(
  addresses: ContactAddressInput[] | undefined,
): Address[] | undefined {
  if (!addresses?.length) return undefined;
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

function mapPhones(
  phones: ContactPhoneInput[] | undefined,
): Phone[] | undefined {
  if (!phones?.length) return undefined;
  return phones.map((p) => ({
    phoneType: Phone.PhoneTypeEnum[p.phoneType] as Phone.PhoneTypeEnum,
    phoneNumber: p.phoneNumber,
    phoneAreaCode: p.phoneAreaCode,
    phoneCountryCode: p.phoneCountryCode,
  }));
}

async function createContact(
  name: string,
  email?: string,
  phone?: string,
  accountNumber?: string,
  addresses?: ContactAddressInput[],
  phones?: ContactPhoneInput[],
): Promise<Contact | undefined> {
  await xeroClient.authenticate();

  const mappedPhones = phones?.length
    ? mapPhones(phones)
    : phone
      ? [
          {
            phoneNumber: phone,
            phoneType: Phone.PhoneTypeEnum.MOBILE,
          },
        ]
      : undefined;

  const contact: Contact = {
    name,
    emailAddress: email,
    accountNumber,
    phones: mappedPhones,
    addresses: mapAddresses(addresses),
  };

  const response = await xeroClient.accountingApi.createContacts(
    xeroClient.tenantId,
    {
      contacts: [contact],
    }, //contacts
    true, //summarizeErrors
    undefined, //idempotencyKey
    getClientHeaders(), // options
  );

  return response.body.contacts?.[0];
}

/**
 * Create a new invoice in Xero
 */
export async function createXeroContact(
  name: string,
  email?: string,
  phone?: string,
  accountNumber?: string,
  addresses?: ContactAddressInput[],
  phones?: ContactPhoneInput[],
): Promise<XeroClientResponse<Contact>> {
  try {
    const createdContact = await createContact(name, email, phone, accountNumber, addresses, phones);

    if (!createdContact) {
      throw new Error("Contact creation failed.");
    }

    return {
      result: createdContact,
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
