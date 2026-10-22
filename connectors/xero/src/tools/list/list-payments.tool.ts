import { z } from "zod";
import { listXeroPayments } from "../../handlers/list-xero-payments.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { Payment } from "xero-node";

// Xero's Payments payloads sometimes carry account stubs with only
// AccountID + Code (no Name) — render whatever identifies the account
// instead of dropping the line, and show the code whenever it is present.
function formatPaymentAccount(account: NonNullable<Payment["account"]>): string {
  const name =
    account.name ??
    (account.code != null ? `account code ${account.code}` : "Unnamed account");
  const codeSuffix =
    account.name && account.code != null ? ` [code ${account.code}]` : "";
  return `Account: ${name}${codeSuffix} (${account.accountID || "Unknown ID"})`;
}

export function formatPayment(payment: Payment): string {
  // Payment amounts are in the invoice's currency; Xero only states that
  // currency on the expanded invoice sub-object.
  const currency = payment.invoice?.currencyCode;
  return [
    `Payment ID: ${payment.paymentID || "Unknown"}`,
    `Date: ${payment.date || "Unknown date"}`,
    `Amount: ${payment.amount ?? 0}${currency ? ` ${currency}` : ""}`,
    payment.bankAmount !== undefined && payment.bankAmount !== payment.amount
      ? `Bank Amount: ${payment.bankAmount} (in the bank account's own currency)`
      : null,
    payment.currencyRate !== undefined && payment.currencyRate !== 1
      ? `Currency Rate: ${payment.currencyRate}`
      : null,
    payment.reference ? `Reference: ${payment.reference}` : null,
    payment.status ? `Status: ${payment.status}` : null,
    payment.paymentType ? `Payment Type: ${payment.paymentType}` : null,
    payment.updatedDateUTC ? `Last Updated: ${payment.updatedDateUTC}` : null,
    payment.account ? formatPaymentAccount(payment.account) : null,
    payment.invoice
      ? [
          `Invoice:`,
          `  Invoice Number: ${payment.invoice.invoiceNumber || "Unknown"}`,
          `  Invoice ID: ${payment.invoice.invoiceID || "Unknown"}`,
          payment.invoice.contact
            ? `  Contact: ${payment.invoice.contact.name || "Unknown"} (${payment.invoice.contact.contactID || "Unknown ID"})`
            : null,
          payment.invoice.type ? `  Type: ${payment.invoice.type}` : null,
          currency ? `  Currency: ${currency}` : null,
          payment.invoice.total !== undefined
            ? `  Total: ${payment.invoice.total}${currency ? ` ${currency}` : ""}`
            : null,
          payment.invoice.amountDue !== undefined
            ? `  Amount Due: ${payment.invoice.amountDue}${currency ? ` ${currency}` : ""}`
            : null,
        ]
          .filter(Boolean)
          .join("\n")
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

const ListPaymentsTool = CreateXeroTool(
  "list_payments",
  `List payments made against invoices in Xero, most recently updated first, 10 per page.
  Amounts are in the invoice's currency (code shown when known); for cross-currency
  payments the Bank Amount line shows the amount in the bank account's currency.
  DELETED payments are excluded by default (their count is reported in the header;
  pass includeDeleted: true to view them — a lookup by paymentId always includes them).
  You can filter by invoice number, invoice ID, payment ID, or invoice reference.
  The header reports 'page N of M; T total' from Xero's pagination metadata —
  trust it over counting returned rows, and call again with the next page number
  (and the same filters) to paginate.`,
  {
    page: z.number().default(1),
    invoiceNumber: z.string().optional(),
    invoiceId: z
      .string()
      .guid("invoiceId must be a valid Xero GUID")
      .optional(),
    paymentId: z
      .string()
      .guid("paymentId must be a valid Xero GUID")
      .optional(),
    reference: z.string().optional(),
    includeDeleted: z
      .boolean()
      .optional()
      .describe(
        "Include DELETED payments (excluded by default). Deleted rows are identifiable by their Status line.",
      ),
  },
  async ({ page, invoiceNumber, invoiceId, paymentId, reference, includeDeleted }) => {
    const response = await listXeroPayments(page, {
      invoiceNumber,
      invoiceId,
      paymentId,
      reference,
      includeDeleted,
    });

    if (response.error !== null) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing payments: ${response.error}`,
          },
        ],
      };
    }

    const { payments, pagination, defaultStatusFilterApplied, excludedDeleted } =
      response.result;

    const headerParts: string[] = [];
    headerParts.push(
      pagination?.pageCount !== undefined && pagination?.itemCount !== undefined
        ? `Found ${payments.length} payments (page ${page} of ${pagination.pageCount}; ${pagination.itemCount} total matching).`
        : `Found ${payments.length} payments (page ${page}; 10 per page — if 10 were returned, more pages may exist).`,
    );
    if (defaultStatusFilterApplied) {
      headerParts.push(
        excludedDeleted !== undefined
          ? `Excluded by default: ${excludedDeleted} DELETED payments — pass includeDeleted: true to view them.`
          : "DELETED payments are excluded by default (count reported on page 1) — pass includeDeleted: true to view them.",
      );
    }
    if (
      payments.length === 0 &&
      (invoiceNumber || invoiceId || paymentId || reference)
    ) {
      headerParts.push(
        "Note: Xero returns an empty page (HTTP 200) even when a filtered invoice/payment ID, number or reference does not exist — 0 results does NOT confirm the invoice or payment exists. Verify with get_invoice or get_payment.",
      );
    }

    return {
      content: [
        {
          type: "text" as const,
          text: headerParts.join("\n"),
        },
        ...payments.map((payment) => ({
          type: "text" as const,
          text: formatPayment(payment),
        })),
      ],
    };
  },
);

export default ListPaymentsTool;
