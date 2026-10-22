import { xeroClient } from "../clients/xero-client.js";
import { Contact } from "xero-node";

import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function getXeroContact(
  contactId: string,
): Promise<XeroClientResponse<Contact>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getContact(
      xeroClient.tenantId,
      contactId,
    );

    const contact = response.body.contacts?.[0];

    if (!contact) {
      return {
        result: null,
        isError: true,
        error: "Contact not found.",
      };
    }

    return {
      result: contact,
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
