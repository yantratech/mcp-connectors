import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { CreditNote, Pagination } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { assertGuid } from "../helpers/assert-guid.js";

// Statuses returned when the caller does not filter. DELETED and VOIDED
// credit notes are excluded by default so counts and credit aggregates
// computed from a default listing are clean; callers opt in via the
// `statuses` param.
export const DEFAULT_CREDIT_NOTE_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "AUTHORISED",
  "PAID",
];

export interface ListCreditNotesResult {
  creditNotes: CreditNote[];
  pagination?: Pagination;
  // True when no explicit statuses filter was given and DEFAULT_CREDIT_NOTE_STATUSES applied.
  defaultStatusFilterApplied: boolean;
  // Universe counts of records hidden by the default status filter
  // (respecting any contact filter). Fetched best-effort on page 1 of
  // default-filtered calls only; undefined otherwise or if the lookup fails.
  excludedDeleted?: number;
  excludedVoided?: number;
}

// GET /CreditNotes has no statuses parameter (unlike /Invoices), so status
// filtering goes into the where clause. Statuses are zod-enum validated in
// the tool schema; guard again here before interpolation.
const VALID_CREDIT_NOTE_STATUSES = new Set([
  ...DEFAULT_CREDIT_NOTE_STATUSES,
  "VOIDED",
  "DELETED",
]);

function statusCondition(statuses: string[]): string {
  const clauses = statuses.map((status) => {
    if (!VALID_CREDIT_NOTE_STATUSES.has(status)) {
      throw new Error(`Invalid credit note status: ${status}`);
    }
    return `Status=="${status}"`;
  });
  return clauses.length === 1 ? clauses[0] : `(${clauses.join(" OR ")})`;
}

async function getCreditNotesPage(
  contactId: string | undefined,
  page: number,
  statuses: string[],
  pageSize: number,
) {
  const whereConditions: string[] = [];
  if (contactId) {
    // GUIDs go into a guid("...") literal (not a quoted string), so validate
    // the format so a value containing `")` cannot inject filter conditions.
    whereConditions.push(
      `Contact.ContactID=guid("${assertGuid(contactId, "contactId")}")`,
    );
  }
  whereConditions.push(statusCondition(statuses));

  return xeroClient.accountingApi.getCreditNotes(
    xeroClient.tenantId,
    undefined, // ifModifiedSince
    whereConditions.join(" AND "), // where
    "UpdatedDateUTC DESC", // order
    page, // page
    undefined, // unitdp
    pageSize, // pageSize
    getClientHeaders(),
  );
}

async function getCreditNotes(
  contactId: string | undefined,
  page: number,
  statuses: string[] | undefined,
): Promise<ListCreditNotesResult> {
  // Validate the GUID BEFORE authenticating so a bad id fails fast without a
  // wasted token exchange (same ordering as the payments and bank-transaction
  // handlers). getCreditNotesPage re-asserts it before interpolation.
  if (contactId) {
    assertGuid(contactId, "contactId");
  }

  await xeroClient.authenticate();

  const defaultStatusFilterApplied = !statuses || statuses.length === 0;
  const effectiveStatuses = defaultStatusFilterApplied
    ? DEFAULT_CREDIT_NOTE_STATUSES
    : (statuses as string[]);

  const response = await getCreditNotesPage(
    contactId,
    page,
    effectiveStatuses,
    10,
  );

  const result: ListCreditNotesResult = {
    creditNotes: response.body.creditNotes ?? [],
    pagination: response.body.pagination,
    defaultStatusFilterApplied,
  };

  if (defaultStatusFilterApplied && page === 1) {
    // Leading excluded-count signal for the default listing: pageSize-1 count
    // probes per hidden status. Best-effort — a failure here must not fail
    // the listing itself.
    try {
      const countOf = async (status: string) => {
        const res = await getCreditNotesPage(contactId, 1, [status], 1);
        return res.body.pagination?.itemCount;
      };
      result.excludedDeleted = await countOf("DELETED");
      result.excludedVoided = await countOf("VOIDED");
    } catch {
      // Counts stay undefined; the tool still notes the exclusion.
    }
  }

  return result;
}

/**
 * List credit notes from Xero (DELETED/VOIDED excluded unless requested)
 */
export async function listXeroCreditNotes(
  page: number = 1,
  contactId?: string,
  statuses?: string[],
): Promise<XeroClientResponse<ListCreditNotesResult>> {
  try {
    const result = await getCreditNotes(contactId, page, statuses);

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
