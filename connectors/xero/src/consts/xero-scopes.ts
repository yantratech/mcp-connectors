/**
 * OAuth scopes requested for the client_credentials (Custom Connection)
 * token. Least privilege: every scope here backs at least one tool, and
 * test/oauth-scopes.test.mjs maps every payroll/report SDK call in the
 * compiled handlers to the scope it needs.
 *
 * Only ever REMOVE scopes here without coordination. A Custom Connection
 * rejects the whole token request (invalid_scope) if it asks for a scope the
 * connection was not granted at developer.xero.com, so ADDING or SWAPPING a
 * scope breaks every existing connection until its owner re-grants it.
 *
 * Deliberately NOT requested (no tool uses them), see SECURITY.md:
 *  - payroll.payruns(.read), payroll.payslip(.read): pay runs and payslips
 *    are intentionally excluded endpoints;
 *  - payroll.employees (write): employee and leave records are read-only
 *    here, served by payroll.employees.read;
 *  - accounting.reports.tenninetynine.read: no 1099 report tool.
 *
 * Receipts are opt-in. The Receipts endpoint has no granular scope and is
 * reachable only via the deprecated broad `accounting.transactions(.read)`
 * scopes, which Custom Connections created on/after 29 Apr 2026 cannot be
 * granted. Requesting them by default would make the whole token request
 * fail with invalid_scope on such connections, breaking every tool, so they
 * are requested (and the receipt tools registered) only when
 * XERO_ENABLE_RECEIPTS=1.
 *
 * Journals are opt-in for the same reason. Xero no longer grants
 * `accounting.journals.read` to Custom Connections created on/after
 * 29 Apr 2026 (the Journals endpoint now needs Xero's Advanced tier), so it
 * is requested (and list_journals / get_journal registered) only when
 * XERO_ENABLE_JOURNALS=1. Manual journals are a separate endpoint, covered
 * by accounting.manualjournals(.read) below.
 *
 * Bearer-token mode (XERO_CLIENT_BEARER_TOKEN) does not use these lists:
 * that token's scopes are fixed by whoever issued it. XERO_ENABLE_RECEIPTS
 * and XERO_ENABLE_JOURNALS still control whether the receipt and journal
 * tools are registered.
 */
export const XERO_CLIENT_CREDENTIALS_SCOPES: readonly string[] = [
  // Accounting — transactions (granular). Replaces the deprecated broad
  // `accounting.transactions(.read)` scopes, which Xero sunsets in
  // September 2027 and which new Custom Connections (created on/after
  // 29 Apr 2026) can no longer be granted. Per Xero's published
  // scope→resource table this quartet covers Invoices, CreditNotes,
  // Quotes, PurchaseOrders, RepeatingInvoices, LinkedTransactions, Items,
  // BankTransactions, BankTransfers, Payments, BatchPayments,
  // Overpayments, Prepayments and ManualJournals.
  "accounting.invoices",
  "accounting.invoices.read",
  "accounting.payments",
  "accounting.payments.read",
  "accounting.banktransactions",
  "accounting.banktransactions.read",
  "accounting.manualjournals",
  "accounting.manualjournals.read",
  // Accounting — contacts & settings
  "accounting.contacts",
  "accounting.contacts.read",
  "accounting.settings",
  "accounting.settings.read",
  // Accounting — reports (granular). Replaces the deprecated broad
  // `accounting.reports.read`; only the report families the tools use.
  "accounting.reports.balancesheet.read",
  "accounting.reports.banksummary.read",
  "accounting.reports.profitandloss.read",
  "accounting.reports.trialbalance.read",
  "accounting.reports.aged.read",
  "accounting.reports.executivesummary.read",
  "accounting.reports.budgetsummary.read",
  // Accounting — other (accounting.journals.read is opt-in, see
  // XERO_JOURNAL_SCOPES)
  "accounting.attachments",
  "accounting.attachments.read",
  "accounting.budgets.read",
  // Payroll (NZ API). Employees + employee leave are read-only tools;
  // timesheets are read/write (create/approve/revert/delete/lines).
  // payroll.settings backs list_payroll_leave_types (org leave types). It is
  // the write form although only reads are made: swapping it for
  // payroll.settings.read would request a scope existing connections may not
  // have been granted (see the note above), so that narrowing would need
  // coordinated re-granting.
  "payroll.settings",
  "payroll.employees.read",
  "payroll.timesheets",
  "payroll.timesheets.read",
  // Assets
  "assets",
  "assets.read",
  // Projects
  "projects",
  "projects.read",
  // Files
  "files",
  "files.read",
];

/**
 * Deprecated broad scopes requested ONLY when receipts are enabled. Receipts
 * has no granular scope; before the Sept 2027 sunset of these scopes the
 * receipt tools must be dropped or migrated.
 */
export const XERO_RECEIPT_SCOPES: readonly string[] = [
  "accounting.transactions",
  "accounting.transactions.read",
];

/** Tools that need XERO_RECEIPT_SCOPES; registered only when enabled. */
export const XERO_RECEIPT_TOOL_NAMES: readonly string[] = [
  "list_receipts",
  "get_receipt",
  "create_receipt",
];

/**
 * Requested ONLY when journals are enabled. Custom Connections created before
 * 29 Apr 2026 that hold it can still request it; newer ones cannot, unless
 * Xero grants them Advanced-tier access to the Journals endpoint.
 */
export const XERO_JOURNAL_SCOPES: readonly string[] = [
  "accounting.journals.read",
];

/** Tools that need XERO_JOURNAL_SCOPES; registered only when enabled. */
export const XERO_JOURNAL_TOOL_NAMES: readonly string[] = [
  "list_journals",
  "get_journal",
];

/** An opt-in flag is on only when set to "1" or "true" (any case, trimmed). */
function optInSet(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === "1" || v === "true";
}

/** True when the operator opted in with XERO_ENABLE_RECEIPTS=1 (or "true"). */
export function receiptsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return optInSet(env.XERO_ENABLE_RECEIPTS);
}

/** True when the operator opted in with XERO_ENABLE_JOURNALS=1 (or "true"). */
export function journalsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return optInSet(env.XERO_ENABLE_JOURNALS);
}

/** The client_credentials scope request for the current configuration. */
export function getClientCredentialsScopes(
  env: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  return [
    ...XERO_CLIENT_CREDENTIALS_SCOPES,
    ...(receiptsEnabled(env) ? XERO_RECEIPT_SCOPES : []),
    ...(journalsEnabled(env) ? XERO_JOURNAL_SCOPES : []),
  ];
}

/**
 * For handlers that accept a "receipts" entityType (attachments, history):
 * returns an error message when receipts are not enabled, else null.
 */
export function receiptsDisabledError(
  entityType: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (entityType !== "receipts" || receiptsEnabled(env)) return null;
  return (
    "Receipts are disabled. Set XERO_ENABLE_RECEIPTS=1 (and grant the " +
    "accounting.transactions and accounting.transactions.read scopes on the " +
    "Xero connection) to use receipts."
  );
}
