import { xeroClient } from "../clients/xero-client.js";
import { Contact, Phone } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

interface ContactInput {
  name: string;
  emailAddress?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  accountNumber?: string;
  taxNumber?: string;
}

export async function batchCreateXeroContacts(
  contacts: ContactInput[],
  summarizeErrors: boolean = true,
): Promise<XeroClientResponse<Contact[]>> {
  try {
    await xeroClient.authenticate();

    const xeroContacts: Contact[] = contacts.map((c) => ({
      name: c.name,
      emailAddress: c.emailAddress,
      firstName: c.firstName,
      lastName: c.lastName,
      phones: c.phone
        ? [{ phoneNumber: c.phone, phoneType: Phone.PhoneTypeEnum.DEFAULT }]
        : undefined,
      accountNumber: c.accountNumber,
      taxNumber: c.taxNumber,
    }));

    const response = await xeroClient.accountingApi.updateOrCreateContacts(
      xeroClient.tenantId,
      { contacts: xeroContacts },
      summarizeErrors,
      undefined, // idempotencyKey
      getClientHeaders(),
    );

    return {
      result: response.body.contacts ?? [],
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
