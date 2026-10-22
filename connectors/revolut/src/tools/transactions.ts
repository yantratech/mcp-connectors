import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  errorMessage,
  fail,
  ok,
  okCompact,
  READ_ONLY,
  registerStrictTool,
  type ToolContext,
} from "../mcp-helpers.js";

// Verified against the GET /transactions docs on 2026-07-13: exactly these
// 16 values.
const TRANSACTION_TYPES = [
  "atm",
  "card_payment",
  "card_refund",
  "card_chargeback",
  "card_credit",
  "charge",
  "charge_refund",
  "exchange",
  "transfer",
  "loan",
  "fee",
  "refund",
  "topup",
  "topup_return",
  "tax",
  "tax_refund",
] as const;

const DEFAULT_COUNT = 50;

const NON_MOVEMENT_STATES = ["declined", "failed", "reverted"] as const;

const NON_MOVEMENT_NOTE =
  "declined/failed/reverted transactions are not money movement (their leg " +
  "amounts never settled, or were undone) — exclude them from spend totals.";

/** The raw-transaction fields the compact projection reads. */
interface RawLeg {
  amount?: number;
  currency?: string;
  description?: string;
  [key: string]: unknown;
}

interface RawTransaction {
  id?: string;
  created_at?: string;
  state?: string;
  reason_code?: string;
  type?: string;
  reference?: string;
  merchant?: { name?: string };
  legs?: RawLeg[];
  [key: string]: unknown;
}

/**
 * Compact row: id/date/state/type plus each leg's money facts and the
 * merchant name. Drops merchant detail, card, leg ids/running balances —
 * those are behind detail:"full" or get_transaction.
 */
function toCompactRow(t: RawTransaction): Record<string, unknown> {
  const legs = Array.isArray(t.legs) ? t.legs : [];
  const row: Record<string, unknown> = {
    id: t.id,
    created_at: t.created_at,
    state: t.state,
  };
  if (t.reason_code !== undefined) row.reason_code = t.reason_code;
  row.type = t.type;
  if (legs.length === 1) {
    row.amount = legs[0].amount;
    row.currency = legs[0].currency;
    row.description = legs[0].description;
  } else if (legs.length > 1) {
    // Multi-leg (e.g. an exchange between own accounts) has no single amount.
    row.legs = legs.map((l) => ({
      amount: l.amount,
      currency: l.currency,
      description: l.description,
    }));
  }
  if (t.merchant?.name !== undefined) row.counterparty = t.merchant.name;
  if (t.reference !== undefined) row.reference = t.reference;
  return row;
}

export function registerTransactionTools(
  server: McpServer,
  ctx: ToolContext,
): void {
  registerStrictTool(
    server,
    "list_transactions",
    "List transactions, newest first, as compact rows (id, created_at, " +
      "state, type, amount + currency, description, merchant name, " +
      "reference); pass detail:'full' for raw records with complete " +
      "merchant/card/leg objects (~3x larger), or get_transaction for one. " +
      "Results include declined/failed/reverted transactions — those are NOT " +
      "money movement and must be excluded from spend totals; a leading " +
      "`states` breakdown counts them and every row carries `state`. " +
      "Pagination signals lead the response: `count` is only this page's row " +
      "count, and when `more_available` is true pass `next_page_to` as `to` " +
      "to fetch the next page. The cursor is timestamp-only, so items " +
      "sharing the boundary created_at may repeat or be skipped across " +
      "pages. Filter to one account with account_id. Read-only.",
    {
      from: z
        .string()
        .optional()
        .describe("ISO 8601 lower bound on created_at (inclusive)"),
      to: z
        .string()
        .optional()
        .describe(
          "ISO 8601 upper bound on created_at; also the pagination cursor",
        ),
      account_id: z
        .string()
        .guid()
        .optional()
        .describe("Filter to one account UUID (from list_accounts)"),
      account: z
        .string()
        .guid()
        .optional()
        .describe(
          "Alias of account_id (Revolut's own name for this filter); prefer account_id",
        ),
      count: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe("Page size, 1–1000 (default 50; API caps a page at 1000)"),
      type: z
        .enum(TRANSACTION_TYPES)
        .optional()
        .describe("Filter by transaction type"),
      detail: z
        .enum(["compact", "full"])
        .optional()
        .describe(
          "'compact' (default) projects each row to id/created_at/state/" +
            "type/amount/currency/description/counterparty/reference; " +
            "'full' returns raw Revolut records including merchant, card, " +
            "and per-leg detail (~3x larger — keep count small)",
        ),
    },
    READ_ONLY,
    async ({ from, to, account_id, account: accountAlias, count, type, detail }) => {
      // `account` is Revolut's own name for this query parameter; every other
      // tool here says `account_id`. Accept both, but never guess between two
      // different values.
      if (
        account_id !== undefined &&
        accountAlias !== undefined &&
        account_id.toLowerCase() !== accountAlias.toLowerCase()
      ) {
        return fail(
          "account_id and account (an alias of account_id) disagree; pass only account_id.",
        );
      }
      const account = account_id ?? accountAlias;
      const effectiveCount = count ?? DEFAULT_COUNT;
      ctx.log("list_transactions", {
        from,
        to,
        account,
        count: effectiveCount,
        type,
        detail,
      });
      try {
        const transactions = (await ctx.client.listTransactions({
          from,
          to,
          account,
          count: effectiveCount,
          type,
        })) as RawTransaction[];
        // A full page implies there may be more. The API cursor is
        // timestamp-only, so items sharing the boundary created_at may repeat
        // or be skipped across pages.
        const last = transactions[transactions.length - 1];
        const nextPageTo =
          transactions.length >= effectiveCount && last?.created_at
            ? last.created_at
            : null;
        const states: Record<string, number> = {};
        for (const t of transactions) {
          const state = t.state ?? "unknown";
          states[state] = (states[state] ?? 0) + 1;
        }
        const nonMovement = NON_MOVEMENT_STATES.reduce(
          (sum, s) => sum + (states[s] ?? 0),
          0,
        );
        return okCompact({
          count: transactions.length,
          more_available: nextPageTo !== null,
          next_page_to: nextPageTo,
          ...(nextPageTo !== null && {
            page_note:
              `Showing ${transactions.length} transactions of an unknown ` +
              "total — pass next_page_to as `to` for the next page.",
          }),
          states,
          ...(nonMovement > 0 && { states_note: NON_MOVEMENT_NOTE }),
          transactions:
            detail === "full" ? transactions : transactions.map(toCompactRow),
        });
      } catch (error) {
        return fail(errorMessage(error));
      }
    },
  );

  registerStrictTool(
    server,
    "get_transaction",
    "Get a single transaction by its id (includes legs[], state, reference, " +
      "and counterparty info). legs[].balance is the account's running " +
      "balance immediately AFTER this transaction (absent on declined/" +
      "reverted ones), not the current balance. A declined/failed/reverted " +
      "state means the leg amounts are not money movement. Read-only.",
    {
      transaction_id: z.string().min(1).describe("Transaction id"),
    },
    READ_ONLY,
    async ({ transaction_id }) => {
      ctx.log("get_transaction", { transaction_id });
      try {
        return ok(await ctx.client.getTransaction(transaction_id));
      } catch (error) {
        return fail(errorMessage(error));
      }
    },
  );
}
