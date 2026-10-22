import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { escapeWhereValue } from "../helpers/escape-where-value.js";
import { formatError } from "../helpers/format-error.js";
import { Pagination, Payment } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { assertGuid } from "../helpers/assert-guid.js";

export interface ListPaymentsResult {
  payments: Payment[];
  pagination?: Pagination;
  // True when the default Status!="DELETED" filter was applied (i.e. neither
  // includeDeleted nor a targeted paymentId lookup was used).
  defaultStatusFilterApplied: boolean;
  // Universe count of DELETED payments hidden by the default filter
  // (respecting the other filters). Fetched best-effort on page 1 of
  // default-filtered calls only; undefined otherwise or if the lookup fails.
  excludedDeleted?: number;
}

async function getPayments(
  page: number = 1,
  {
    invoiceNumber,
    invoiceId,
    paymentId,
    reference,
    includeDeleted,
  }: {
    invoiceNumber?: string;
    invoiceId?: string;
    paymentId?: string;
    reference?: string;
    includeDeleted?: boolean;
  },
): Promise<ListPaymentsResult> {
  // Build (and validate) the where clause BEFORE authenticating so a bad
  // GUID fails fast without a wasted token exchange and never reaches Xero.
  const whereConditions: string[] = [];

  if (invoiceId) {
    // GUIDs go into a guid("...") literal (not a quoted string), so
    // escapeWhereValue does not apply — validate the format instead so a
    // value containing `")` cannot break out and inject filter conditions.
    whereConditions.push(`Invoice.InvoiceID==guid("${assertGuid(invoiceId, "invoiceId")}")`);
  }
  if (invoiceNumber) {
    whereConditions.push(
      `Invoice.InvoiceNumber=="${escapeWhereValue(invoiceNumber)}"`,
    );
  }
  if (paymentId) {
    whereConditions.push(`PaymentID==guid("${assertGuid(paymentId, "paymentId")}")`);
  }
  if (reference) {
    whereConditions.push(`Reference=="${escapeWhereValue(reference)}"`);
  }

  // Exclude DELETED payments by default so payment totals computed from the
  // listing are clean. A targeted paymentId lookup skips the exclusion — a
  // caller asking for a specific payment must find it even if deleted.
  const defaultStatusFilterApplied = !includeDeleted && !paymentId;
  const baseConditions = [...whereConditions];
  if (defaultStatusFilterApplied) {
    whereConditions.push('Status!="DELETED"');
  }

  // Combine conditions
  const where =
    whereConditions.length > 0 ? whereConditions.join(" AND ") : undefined;

  await xeroClient.authenticate();

  const response = await xeroClient.accountingApi.getPayments(
    xeroClient.tenantId,
    undefined, // ifModifiedSince
    where,
    "UpdatedDateUTC DESC", // order
    page, // page
    10, // pageSize
    getClientHeaders(), // options
  );

  const result: ListPaymentsResult = {
    payments: response.body.payments ?? [],
    pagination: response.body.pagination,
    defaultStatusFilterApplied,
  };

  if (defaultStatusFilterApplied && page === 1) {
    // Leading excluded-count signal. Best-effort — a failure here must not
    // fail the listing itself.
    try {
      const deleted = await xeroClient.accountingApi.getPayments(
        xeroClient.tenantId,
        undefined,
        [...baseConditions, 'Status=="DELETED"'].join(" AND "),
        undefined,
        1, // page
        1, // pageSize
        getClientHeaders(),
      );
      result.excludedDeleted = deleted.body.pagination?.itemCount;
    } catch {
      // Count stays undefined; the tool still notes the exclusion.
    }
  }

  return result;
}

/**
 * List payments from Xero (DELETED excluded unless requested or looked up by id)
 */
export async function listXeroPayments(
  page: number = 1,
  {
    invoiceNumber,
    invoiceId,
    paymentId,
    reference,
    includeDeleted,
  }: {
    invoiceNumber?: string;
    invoiceId?: string;
    paymentId?: string;
    reference?: string;
    includeDeleted?: boolean;
  },
): Promise<XeroClientResponse<ListPaymentsResult>> {
  try {
    const result = await getPayments(page, {
      invoiceNumber,
      invoiceId,
      paymentId,
      reference,
      includeDeleted,
    });

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
