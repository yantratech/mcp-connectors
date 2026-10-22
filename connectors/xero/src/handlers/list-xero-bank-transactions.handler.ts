import { xeroClient } from "../clients/xero-client.js";
import { BankTransaction, Pagination } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { assertGuid } from "../helpers/assert-guid.js";

export interface ListBankTransactionsResult {
  bankTransactions: BankTransaction[];
  pagination?: Pagination;
  // Universe count of DELETED transactions hidden by the default filter
  // (respecting any bank-account filter). Fetched best-effort on page 1 of
  // default-filtered calls only; undefined otherwise or if the lookup fails.
  excludedDeleted?: number;
}

function buildWhere(bankAccountId?: string, statusClause?: string): string | undefined {
  const conditions: string[] = [];
  if (bankAccountId) {
    // The guid("...") literal is not a quoted string, so escaping cannot make
    // it safe — validate the format instead so a value containing `")` cannot
    // break out and inject filter conditions.
    conditions.push(
      `BankAccount.AccountID=guid("${assertGuid(bankAccountId, "bankAccountId")}")`,
    );
  }
  if (statusClause) {
    conditions.push(statusClause);
  }
  return conditions.length > 0 ? conditions.join(" AND ") : undefined;
}

async function getBankTransactions(
  page: number,
  bankAccountId?: string,
  includeDeleted?: boolean,
): Promise<ListBankTransactionsResult> {
  // Validate/build the where clause BEFORE authenticating so a bad GUID
  // fails fast without a wasted token exchange and never reaches Xero.
  const where = buildWhere(
    bankAccountId,
    includeDeleted ? undefined : 'Status!="DELETED"',
  );
  const deletedCountWhere = includeDeleted
    ? undefined
    : buildWhere(bankAccountId, 'Status=="DELETED"');

  await xeroClient.authenticate();

  const response = await xeroClient.accountingApi.getBankTransactions(xeroClient.tenantId,
      undefined, // ifModifiedSince
      where, // where
      "Date DESC", // order
      page, // page
      undefined, // unitdp
      10, // pagesize
      undefined, // references
      getClientHeaders()
  );

  const result: ListBankTransactionsResult = {
    bankTransactions: response.body.bankTransactions ?? [],
    pagination: response.body.pagination,
  };

  if (deletedCountWhere && page === 1) {
    // Leading excluded-count signal. Best-effort — a failure here must not
    // fail the listing itself.
    try {
      const deleted = await xeroClient.accountingApi.getBankTransactions(
        xeroClient.tenantId,
        undefined,
        deletedCountWhere,
        "Date DESC",
        1,
        undefined,
        1,
        undefined, // references
        getClientHeaders(),
      );
      result.excludedDeleted = deleted.body.pagination?.itemCount;
    } catch {
      // Count stays undefined; the tool still notes the exclusion.
    }
  }

  return result;
}

export async function listXeroBankTransactions(
  page: number = 1,
  bankAccountId?: string,
  includeDeleted?: boolean,
): Promise<XeroClientResponse<ListBankTransactionsResult>> {
  try {
    const result = await getBankTransactions(page, bankAccountId, includeDeleted);

    return {
      result,
      isError: false,
      error: null
    }
  } catch (error) {
    return {
      result: null,
      isError: true,
      error: formatError(error)
    }
  }
}
