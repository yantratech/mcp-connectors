import { z } from "zod";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { listXeroBankTransactions } from "../../handlers/list-xero-bank-transactions.handler.js";
import { formatLineItem } from "../../helpers/format-line-item.js";
import { BankTransaction } from "xero-node";

export function formatBankTransaction(transaction: BankTransaction): string {
  return [
    `Bank Transaction ID: ${transaction.bankTransactionID}`,
    transaction.bankAccount
      ? `Bank Account: ${transaction.bankAccount.name} (${transaction.bankAccount.accountID})`
      : null,
    transaction.contact
      ? `Contact: ${transaction.contact.name} (${transaction.contact.contactID})`
      : null,
    transaction.reference ? `Reference: ${transaction.reference}` : null,
    transaction.date ? `Date: ${transaction.date}` : null,
    transaction.subTotal !== undefined ? `Sub Total: ${transaction.subTotal}` : null,
    transaction.totalTax !== undefined ? `Total Tax: ${transaction.totalTax}` : null,
    transaction.total !== undefined ? `Total: ${transaction.total}` : null,
    transaction.isReconciled !== undefined
      ? `Reconciled: ${transaction.isReconciled ? "Yes" : "No"}`
      : null,
    transaction.currencyCode ? `Currency Code: ${transaction.currencyCode}` : null,
    `Status: ${transaction.status || "Unknown"}`,
    transaction.lineAmountTypes ? `Line Amount Types: ${transaction.lineAmountTypes}` : undefined,
    transaction.hasAttachments !== undefined
      ? (transaction.hasAttachments ? "Has attachments" : "Does not have attachments")
      : null,
    transaction.lineItems?.length
      ? `Line Items:\n${transaction.lineItems.map(formatLineItem).join("\n")}`
      : null,
  ].filter(Boolean).join("\n");
}

const ListBankTransactionsTool = CreateXeroTool(
  "list_bank_transactions",
  `List CODED bank transactions in Xero: spend-money and receive-money transactions
  that have been coded/explained against the ledger, newest first, 10 per page.
  IMPORTANT: this is NOT the raw bank-statement feed — statement lines that have not
  yet been coded do not appear, so few/no results does NOT mean there is no recent
  bank activity. It also does NOT include payments applied to invoices (use
  list_payments for those). DELETED transactions are excluded by default (their
  count is reported in the header; pass includeDeleted: true to view them).
  The header reports 'page N of M; T total' from Xero's pagination metadata —
  trust it over counting returned rows, and call again with the next page number
  (and the same filters) to paginate.`,
  {
    page: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe("Page number, 1-based. Defaults to 1."),
    bankAccountId: z
      .string()
      .guid("bankAccountId must be a valid Xero GUID")
      .optional()
      .describe(
        "Optional AccountID (GUID) of a bank account to filter by — from list_accounts.",
      ),
    includeDeleted: z
      .boolean()
      .optional()
      .describe(
        "Include DELETED bank transactions (excluded by default). Deleted rows are identifiable by their Status line.",
      ),
  },
  async ({ bankAccountId, page, includeDeleted }) => {
    const response = await listXeroBankTransactions(page, bankAccountId, includeDeleted);
    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing bank transactions: ${response.error}`
          }
        ]
      };
    }

    const { bankTransactions, pagination, excludedDeleted } = response.result;

    const headerParts: string[] = [];
    headerParts.push(
      pagination?.pageCount !== undefined && pagination?.itemCount !== undefined
        ? `Found ${bankTransactions.length} coded bank transactions (page ${page} of ${pagination.pageCount}; ${pagination.itemCount} total matching${includeDeleted ? ", including DELETED" : ""}).`
        : `Found ${bankTransactions.length} coded bank transactions (page ${page}; 10 per page — if 10 were returned, more pages may exist).`,
    );
    if (!includeDeleted) {
      headerParts.push(
        excludedDeleted !== undefined
          ? `Excluded by default: ${excludedDeleted} DELETED bank transactions — pass includeDeleted: true to view them.`
          : "DELETED bank transactions are excluded by default (count reported on page 1) — pass includeDeleted: true to view them.",
      );
    }
    if (bankTransactions.length === 0 && bankAccountId) {
      headerParts.push(
        "Note: Xero returns an empty page (HTTP 200) even when the bank account ID does not exist — 0 results does NOT confirm the account exists. Verify it with list_accounts.",
      );
    }

    return {
      content: [
        {
          type: "text" as const,
          text: headerParts.join("\n")
        },
        ...bankTransactions.map((transaction) => ({
          type: "text" as const,
          text: formatBankTransaction(transaction)
        }))
      ]
    };
  }
);

export default ListBankTransactionsTool;
