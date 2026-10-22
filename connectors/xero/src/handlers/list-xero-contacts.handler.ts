import { xeroClient } from "../clients/xero-client.js";
import { Contact, Pagination } from "xero-node";
import { XeroClientResponse } from "../types/tool-response.js";
import { escapeWhereValue } from "../helpers/escape-where-value.js";
import { formatError } from "../helpers/format-error.js";
import { getClientHeaders } from "../helpers/get-client-headers.js";

export interface ListContactsResult {
  contacts: Contact[];
  pagination?: Pagination;
  // Count of ARCHIVED contacts hidden by the default filter (respecting any
  // search/accountNumber filters). Fetched best-effort on page 1 of
  // default-filtered calls only; undefined otherwise or if the lookup fails.
  excludedArchived?: number;
}

async function getContacts(
  page: number,
  searchTerm?: string,
  accountNumber?: string,
  includeArchived?: boolean,
): Promise<ListContactsResult> {
  await xeroClient.authenticate();

  const where = accountNumber
    ? `AccountNumber=="${escapeWhereValue(accountNumber)}"`
    : undefined;

  const contacts = await xeroClient.accountingApi.getContacts(
    xeroClient.tenantId,
    undefined, // ifModifiedSince
    where, // where
    undefined, // order
    undefined, // iDs
    page, // page (always set — omitting it makes Xero return the ENTIRE contact list in one response)
    includeArchived, // includeArchived
    true, // summaryOnly
    searchTerm, // searchTerm
    undefined, // pageSize (Xero default: 100)
    getClientHeaders(),
  );

  const result: ListContactsResult = {
    contacts: contacts.body.contacts ?? [],
    pagination: contacts.body.pagination,
  };

  if (!includeArchived && page === 1) {
    // Leading excluded-count signal: diff the with-archived universe against
    // the visible one. Best-effort — a failure here must not fail the listing.
    try {
      const withArchived = await xeroClient.accountingApi.getContacts(
        xeroClient.tenantId,
        undefined,
        where,
        undefined,
        undefined,
        1, // page
        true, // includeArchived
        true, // summaryOnly
        searchTerm,
        1, // pageSize — only the pagination.itemCount is needed
        getClientHeaders(),
      );
      const total = withArchived.body.pagination?.itemCount;
      const visible = result.pagination?.itemCount;
      if (total !== undefined && visible !== undefined) {
        result.excludedArchived = Math.max(0, total - visible);
      }
    } catch {
      // Count stays undefined; the tool still notes the exclusion.
    }
  }

  return result;
}

/**
 * List contacts from Xero (ARCHIVED excluded unless requested)
 */
export async function listXeroContacts(
  page: number = 1,
  searchTerm?: string,
  accountNumber?: string,
  includeArchived?: boolean,
): Promise<XeroClientResponse<ListContactsResult>> {
  try {
    const result = await getContacts(page, searchTerm, accountNumber, includeArchived);

    return {
      result,
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
