import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { Invoice, Pagination } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";

// Statuses returned when the caller does not filter. DELETED and VOIDED
// invoices are excluded by default so counts and revenue aggregates computed
// from a default listing are clean; callers opt in via the `statuses` param.
export const DEFAULT_INVOICE_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "AUTHORISED",
  "PAID",
];

export interface ListInvoicesResult {
  invoices: Invoice[];
  pagination?: Pagination;
  // True when no explicit statuses filter was given and DEFAULT_INVOICE_STATUSES applied.
  defaultStatusFilterApplied: boolean;
  // Universe counts of records hidden by the default status filter (respecting
  // any contact/invoice-number filters). Fetched best-effort on page 1 of
  // default-filtered calls only; undefined otherwise or if the lookup fails.
  excludedDeleted?: number;
  excludedVoided?: number;
}

async function getInvoicesPage(
  invoiceNumbers: string[] | undefined,
  contactIds: string[] | undefined,
  page: number,
  statuses: string[],
  pageSize: number,
) {
  return xeroClient.accountingApi.getInvoices(
    xeroClient.tenantId,
    undefined, // ifModifiedSince
    undefined, // where
    "UpdatedDateUTC DESC", // order
    undefined, // iDs
    invoiceNumbers, // invoiceNumbers
    contactIds, // contactIDs
    statuses, // statuses
    page,
    false, // includeArchived
    false, // createdByMyApp
    undefined, // unitdp
    false, // summaryOnly (must stay false: Xero omits pagination metadata when true)
    pageSize,
    undefined, // searchTerm
    getClientHeaders(),
  );
}

async function getInvoices(
  invoiceNumbers: string[] | undefined,
  contactIds: string[] | undefined,
  page: number,
  statuses: string[] | undefined,
): Promise<ListInvoicesResult> {
  await xeroClient.authenticate();

  const defaultStatusFilterApplied = !statuses || statuses.length === 0;
  const effectiveStatuses = defaultStatusFilterApplied
    ? DEFAULT_INVOICE_STATUSES
    : (statuses as string[]);

  const invoices = await getInvoicesPage(
    invoiceNumbers,
    contactIds,
    page,
    effectiveStatuses,
    10,
  );

  const result: ListInvoicesResult = {
    invoices: invoices.body.invoices ?? [],
    pagination: invoices.body.pagination,
    defaultStatusFilterApplied,
  };

  if (defaultStatusFilterApplied && page === 1) {
    // Leading excluded-count signal for the default listing: pageSize-1 count
    // probes per hidden status. Best-effort — a failure here must not fail
    // the listing itself.
    try {
      const countOf = async (status: string) => {
        const res = await getInvoicesPage(invoiceNumbers, contactIds, 1, [status], 1);
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
 * List invoices from Xero (DELETED/VOIDED excluded unless requested)
 */
export async function listXeroInvoices(
  page: number = 1,
  contactIds?: string[],
  invoiceNumbers?: string[],
  statuses?: string[],
): Promise<XeroClientResponse<ListInvoicesResult>> {
  try {
    const result = await getInvoices(invoiceNumbers, contactIds, page, statuses);

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
