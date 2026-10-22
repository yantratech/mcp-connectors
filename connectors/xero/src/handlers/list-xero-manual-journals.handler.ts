import { ManualJournal, Pagination } from "xero-node";
import { xeroClient } from "../clients/xero-client.js";
import { formatError } from "../helpers/format-error.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { getClientHeaders } from "../helpers/get-client-headers.js";

// Statuses returned when the caller does not filter. DELETED and VOIDED
// manual journals have zero ledger effect, so they are excluded by default
// and counts/totals computed from a default listing are clean; callers opt
// in via the `statuses` param.
export const DEFAULT_MANUAL_JOURNAL_STATUSES = ["DRAFT", "POSTED", "ARCHIVED"];

export interface ListManualJournalsResult {
  manualJournals: ManualJournal[];
  pagination?: Pagination;
  // True when no explicit statuses filter was given and DEFAULT_MANUAL_JOURNAL_STATUSES applied.
  defaultStatusFilterApplied: boolean;
  // Universe counts of records hidden by the default status filter. Fetched
  // best-effort on page 1 of default-filtered calls only; undefined otherwise
  // or if the lookup fails.
  excludedDeleted?: number;
  excludedVoided?: number;
}

// Statuses are zod-enum validated in the tool schema; guard again here before
// interpolation because the exported handler is callable directly (same
// defense-in-depth as the credit-notes handler).
const VALID_MANUAL_JOURNAL_STATUSES = new Set([
  ...DEFAULT_MANUAL_JOURNAL_STATUSES,
  "VOIDED",
  "DELETED",
]);

// Sort orders exposed by list_manual_journals. A fixed allowlist rather than
// free text: the value is passed straight to Xero's `order` parameter.
export const MANUAL_JOURNAL_ORDERS = [
  "UpdatedDateUTC DESC",
  "UpdatedDateUTC ASC",
  "Date DESC",
  "Date ASC",
] as const;
export type ManualJournalOrder = (typeof MANUAL_JOURNAL_ORDERS)[number];
export const DEFAULT_MANUAL_JOURNAL_ORDER: ManualJournalOrder =
  "UpdatedDateUTC DESC";

export interface ListManualJournalsFilters {
  // Inclusive journal-date range, YYYY-MM-DD.
  dateFrom?: string;
  dateTo?: string;
  order?: ManualJournalOrder;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Validates a YYYY-MM-DD calendar date and renders it as Xero's where-clause
 * DateTime(y, m, d) literal. Only digits ever reach the clause, so the value
 * cannot inject filter conditions; impossible dates (2026-02-30) are rejected.
 */
function toXeroDateTime(value: string, field: string): string {
  const match = ISO_DATE_RE.exec(value);
  const valid =
    match !== null &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!match || !valid) {
    throw new Error(`${field} must be a valid date in YYYY-MM-DD format`);
  }
  return `DateTime(${Number(match[1])}, ${Number(match[2])}, ${Number(match[3])})`;
}

/**
 * Where-clause conditions for the non-status filters, validated. Kept
 * separate from the status clause so the excluded-count probes apply the
 * same date range as the main listing.
 */
function buildFilterConditions(filters: ListManualJournalsFilters): string[] {
  const conditions: string[] = [];
  if (filters.dateFrom) {
    conditions.push(`Date>=${toXeroDateTime(filters.dateFrom, "dateFrom")}`);
  }
  if (filters.dateTo) {
    conditions.push(`Date<=${toXeroDateTime(filters.dateTo, "dateTo")}`);
  }
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    throw new Error("dateFrom must be on or before dateTo");
  }
  return conditions;
}

function resolveOrder(order?: string): ManualJournalOrder {
  if (order === undefined) {
    return DEFAULT_MANUAL_JOURNAL_ORDER;
  }
  if (!(MANUAL_JOURNAL_ORDERS as readonly string[]).includes(order)) {
    throw new Error(`Invalid manual journal order: ${order}`);
  }
  return order as ManualJournalOrder;
}

function buildStatusWhere(statuses: string[]): string {
  return statuses
    .map((status) => {
      if (!VALID_MANUAL_JOURNAL_STATUSES.has(status)) {
        throw new Error(`Invalid manual journal status: ${status}`);
      }
      return `Status=="${status}"`;
    })
    .join(" OR ");
}

/**
 * Full where clause. With no extra filters this is exactly the status clause
 * (unchanged wire format); with filters, a multi-status OR group is
 * parenthesised so AND binds to the whole group.
 */
function buildWhere(statuses: string[], filterConditions: string[]): string {
  const statusWhere = buildStatusWhere(statuses);
  if (filterConditions.length === 0) {
    return statusWhere;
  }
  const statusGroup = statuses.length > 1 ? `(${statusWhere})` : statusWhere;
  return [statusGroup, ...filterConditions].join(" AND ");
}

async function getManualJournalsPage(
  page: number,
  statuses: string[],
  pageSize: number,
  modifiedAfter: string | undefined,
  filterConditions: string[],
  order: ManualJournalOrder,
) {
  return xeroClient.accountingApi.getManualJournals(
    xeroClient.tenantId,
    modifiedAfter ? new Date(modifiedAfter) : undefined,
    buildWhere(statuses, filterConditions), // where
    order,
    page,
    pageSize,
    getClientHeaders(),
  );
}

async function getManualJournals(
  page: number,
  manualJournalId?: string,
  modifiedAfter?: string,
  statuses?: string[],
  filters: ListManualJournalsFilters = {},
): Promise<ListManualJournalsResult> {
  // Validate filters BEFORE authenticating so a bad date/order fails fast
  // without a wasted token exchange and never reaches Xero. (Ignored for a
  // direct ID fetch, like statuses, but still validated.)
  const filterConditions = buildFilterConditions(filters);
  const order = resolveOrder(filters.order);

  await xeroClient.authenticate();

  if (manualJournalId) {
    const response = await xeroClient.accountingApi.getManualJournal(
      xeroClient.tenantId,
      manualJournalId,
      getClientHeaders(),
    );

    // A direct ID fetch bypasses status filtering: the caller asked for that
    // exact record, whatever its status (which is printed per journal).
    return {
      manualJournals: response.body.manualJournals ?? [],
      defaultStatusFilterApplied: false,
    };
  }

  const defaultStatusFilterApplied = !statuses || statuses.length === 0;
  const effectiveStatuses = defaultStatusFilterApplied
    ? DEFAULT_MANUAL_JOURNAL_STATUSES
    : (statuses as string[]);

  const response = await getManualJournalsPage(
    page,
    effectiveStatuses,
    10,
    modifiedAfter,
    filterConditions,
    order,
  );

  const result: ListManualJournalsResult = {
    manualJournals: response.body.manualJournals ?? [],
    pagination: response.body.pagination,
    defaultStatusFilterApplied,
  };

  if (defaultStatusFilterApplied && page === 1) {
    // Leading excluded-count signal for the default listing: pageSize-1 count
    // probes per hidden status. Best-effort — a failure here must not fail
    // the listing itself.
    try {
      const countOf = async (status: string) => {
        const res = await getManualJournalsPage(
          1,
          [status],
          1,
          modifiedAfter,
          filterConditions,
          order,
        );
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
 * List manual journals from Xero (DELETED/VOIDED excluded unless requested)
 */
export async function listXeroManualJournals(
  page: number = 1,
  manualJournalId?: string,
  modifiedAfter?: string,
  statuses?: string[],
  filters?: ListManualJournalsFilters,
): Promise<XeroClientResponse<ListManualJournalsResult>> {
  try {
    const result = await getManualJournals(
      page,
      manualJournalId,
      modifiedAfter,
      statuses,
      filters,
    );

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
