import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  isNotFound,
  type CreatePaymentDraftBody,
  type DraftPayment,
} from "../client.js";
import {
  CREATE_DRAFT,
  errorMessage,
  fail,
  ok,
  READ_ONLY,
  registerStrictTool,
  type ToolContext,
} from "../mcp-helpers.js";

/** Max length of the attributed draft title we send upstream. */
const MAX_TITLE_LENGTH = 255;

/** A receiving payment method (bank account or card) on a counterparty. */
interface ReceiverMethod {
  kind: "account" | "card";
  id: string;
  currency?: string;
  /** Human hint: masked IBAN / account number, or card last digits. */
  label?: string;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? (value.filter(
        (v) => v && typeof v === "object",
      ) as Record<string, unknown>[])
    : [];
}

/** Collect a counterparty's receiving methods (accounts first, then cards). */
function collectMethods(
  counterparty: Record<string, unknown>,
): ReceiverMethod[] {
  const methods: ReceiverMethod[] = [];
  for (const a of asRecordArray(counterparty.accounts)) {
    if (typeof a.id !== "string") continue;
    methods.push({
      kind: "account",
      id: a.id,
      currency: typeof a.currency === "string" ? a.currency : undefined,
      label:
        (typeof a.iban === "string" && a.iban) ||
        (typeof a.account_no === "string" && a.account_no) ||
        undefined,
    });
  }
  for (const c of asRecordArray(counterparty.cards)) {
    if (typeof c.id !== "string") continue;
    methods.push({
      kind: "card",
      id: c.id,
      currency: typeof c.currency === "string" ? c.currency : undefined,
      label:
        typeof c.last_digits === "string"
          ? `card ****${c.last_digits}`
          : "card",
    });
  }
  return methods;
}

/** Does an existing draft payment match the one we are about to create? */
function paymentMatches(
  payment: Record<string, unknown>,
  counterpartyId: string,
  amount: number,
  currency: string,
  reference: string,
): boolean {
  const receiver = payment.receiver as Record<string, unknown> | undefined;
  if (receiver?.counterparty_id !== counterpartyId) return false;
  if (payment.reference !== reference) return false;

  // In the single-draft read model, `amount` is an object { amount, currency };
  // tolerate a scalar form too, just in case.
  let paidAmount: unknown;
  let paidCurrency: unknown;
  const amt = payment.amount;
  if (amt && typeof amt === "object") {
    paidAmount = (amt as Record<string, unknown>).amount;
    paidCurrency = (amt as Record<string, unknown>).currency;
  } else {
    paidAmount = amt;
    paidCurrency = payment.currency;
  }
  return Number(paidAmount) === amount && paidCurrency === currency;
}

/**
 * Duplicate guard. Lists pending drafts (the API only returns API-created
 * drafts that haven't been sent for processing) and inspects each draft's
 * payments for a counterparty+amount+currency+reference match. Returns the
 * id of a matching draft, or null. Any lookup failure propagates so the
 * caller fails closed rather than risking a duplicate draft. The answer stays
 * true only while the caller holds that payment's lock (withDraftLock)
 * through its own create.
 */
async function findDuplicateDraft(
  ctx: ToolContext,
  counterpartyId: string,
  amount: number,
  currency: string,
  reference: string,
): Promise<string | null> {
  const list = await ctx.client.listPaymentDrafts();
  const orders = asRecordArray(list.payment_orders);
  for (const order of orders) {
    if (typeof order.id !== "string") continue;
    const detail = await ctx.client.getPaymentDraft(order.id);
    for (const payment of asRecordArray(detail.payments)) {
      if (
        paymentMatches(payment, counterpartyId, amount, currency, reference)
      ) {
        return order.id;
      }
    }
  }
  return null;
}

/**
 * One lock per duplicate key (counterparty, amount, currency, reference), so
 * the duplicate check and the create run as one step. The MCP SDK runs
 * overlapping tool calls concurrently; without this, two identical calls could
 * both find no existing draft and both create one. Each entry settles when the
 * latest call for its key finishes, and a new call waits for it, so calls with
 * the same key run one at a time in arrival order. Process-local: separate
 * server processes are not coordinated.
 */
const draftLocks = new Map<string, Promise<void>>();

/** Run fn while holding the lock for key, releasing it however fn ends. */
async function withDraftLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = draftLocks.get(key);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  draftLocks.set(key, held);
  try {
    await previous;
    return await fn();
  } finally {
    if (draftLocks.get(key) === held) draftLocks.delete(key);
    release();
  }
}

export function registerPaymentDraftTools(
  server: McpServer,
  ctx: ToolContext,
): void {
  registerStrictTool(
    server,
    "create_payment_draft",
    "Create a payment DRAFT only. It CANNOT send money — a human must approve " +
      "it in the Revolut Business app before anything is paid. The counterparty " +
      "must already exist; this server cannot create or modify counterparties. " +
      "The draft title is automatically prefixed with the operator name. One " +
      "payment per draft.",
    {
      title: z
        .string()
        .optional()
        .describe("Human-readable purpose; the operator attribution is prepended"),
      schedule_for: z
        .string()
        .optional()
        .describe("Optional ISO 8601 date to schedule the payment for"),
      account_id: z
        .string()
        .guid()
        .describe("UUID of the Revolut account to pay FROM"),
      counterparty_id: z
        .string()
        .guid()
        .describe("UUID of the existing counterparty to pay TO"),
      receiver_account_id: z
        .string()
        .guid()
        .optional()
        .describe(
          "Required only if the counterparty has more than one receiving " +
            "account/card: the id of the specific account (or card) to pay",
        ),
      amount: z.number().positive().finite().describe("Amount, greater than 0"),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .describe("ISO 4217 currency code, e.g. GBP"),
      reference: z
        .string()
        .min(1)
        .describe("Payment reference, e.g. the supplier invoice number"),
      transfer_reason_code: z
        .string()
        .optional()
        .describe(
          "Only if a prior attempt failed asking for one: Revolut requires a " +
            "transfer reason code for certain destination countries/currencies",
        ),
    },
    CREATE_DRAFT,
    async (args) => {
      const {
        title,
        schedule_for,
        account_id,
        counterparty_id,
        receiver_account_id,
        amount,
        currency,
        reference,
        transfer_reason_code,
      } = args;

      ctx.log("create_payment_draft", {
        account_id,
        counterparty_id,
        receiver_account_id,
        amount,
        currency,
        reference,
        schedule_for,
      });

      // 1. Counterparty must exist and be in the `created` state.
      let counterparty: Record<string, unknown>;
      try {
        counterparty = await ctx.client.getCounterparty(counterparty_id);
      } catch (error) {
        if (isNotFound(error)) {
          return fail(
            `No such counterparty (${errorMessage(error)}) — add it manually in ` +
              `the Revolut Business app first. This server cannot create counterparties.`,
          );
        }
        return fail(
          `Could not look up counterparty ${counterparty_id} ` +
            `(${errorMessage(error)}). No draft was created.`,
        );
      }
      if (counterparty.state !== "created") {
        return fail(
          `Counterparty ${counterparty_id} is in state "${String(
            counterparty.state,
          )}", not "created" — it cannot receive a payment. ` +
            `Manage counterparties in the Revolut Business app.`,
        );
      }

      // 2. Resolve the receiving account or card.
      const methods = collectMethods(counterparty);
      const receiver: DraftPayment["receiver"] = { counterparty_id };
      if (receiver_account_id) {
        const chosen = methods.find((m) => m.id === receiver_account_id);
        if (!chosen) {
          return fail(
            `receiver_account_id ${receiver_account_id} is not one of this ` +
              `counterparty's receiving methods. Options: ${JSON.stringify(methods)}`,
          );
        }
        if (chosen.kind === "card") receiver.card_id = chosen.id;
        else receiver.account_id = chosen.id;
      } else if (methods.length > 1) {
        return fail(
          `This counterparty has ${methods.length} receiving methods; specify ` +
            `receiver_account_id. Options: ${JSON.stringify(methods)}`,
        );
      } else if (methods.length === 1) {
        const only = methods[0];
        if (only.kind === "card") receiver.card_id = only.id;
        else receiver.account_id = only.id;
      }
      // methods.length === 0: fall through with receiver = { counterparty_id }
      // and let Revolut resolve/validate the (single implicit) destination.

      // 3. Paying account must exist and be active.
      let payingAccount: Record<string, unknown>;
      try {
        payingAccount = await ctx.client.getAccount(account_id);
      } catch (error) {
        if (isNotFound(error)) {
          return fail(`Paying account not found (${errorMessage(error)}).`);
        }
        return fail(
          `Could not look up paying account ${account_id} ` +
            `(${errorMessage(error)}). No draft was created.`,
        );
      }
      if (payingAccount.state !== "active") {
        return fail(
          `Paying account ${account_id} is not active (state: "${String(
            payingAccount.state,
          )}").`,
        );
      }

      // Steps 4–6 hold the lock for this payment's duplicate key until the
      // create has finished, so an overlapping identical call waits here and
      // its duplicate check then sees any draft this call created.
      const duplicateKey = [counterparty_id, amount, currency, reference];
      return withDraftLock(JSON.stringify(duplicateKey), async () => {
        // 4. Duplicate guard — fail closed if existing drafts cannot be checked.
        let duplicateId: string | null;
        try {
          duplicateId = await findDuplicateDraft(
            ctx,
            counterparty_id,
            amount,
            currency,
            reference,
          );
        } catch (error) {
          return fail(
            `Could not check existing drafts for duplicates ` +
              `(${errorMessage(error)}). Failing closed — no draft was created; ` +
              `retry once the drafts list is readable.`,
          );
        }
        if (duplicateId) {
          return fail(
            `A payment draft with the same counterparty, amount, currency, and ` +
              `reference already exists (draft id ${duplicateId}). Not creating a duplicate.`,
          );
        }

        // 5. Attribution — not controllable by the caller.
        const rawTitle = title ?? reference;
        const attributedTitle = `[${ctx.config.operator} via MCP] ${rawTitle}`.slice(
          0,
          MAX_TITLE_LENGTH,
        );

        // 6. Build and send. One payment per draft (no bulk drafts).
        const payment: DraftPayment = {
          account_id,
          receiver,
          amount,
          currency,
          reference,
        };
        if (transfer_reason_code) payment.transfer_reason_code = transfer_reason_code;

        const body: CreatePaymentDraftBody = {
          title: attributedTitle,
          payments: [payment],
        };
        if (schedule_for) body.schedule_for = schedule_for;

        try {
          const result = await ctx.client.createPaymentDraft(body);
          return ok({
            id: result?.id ?? null,
            title: attributedTitle,
            receiver,
            reminder:
              "Draft created. It will not be paid until approved in the Revolut Business app.",
          });
        } catch (error) {
          return fail(errorMessage(error));
        }
      });
    },
  );

  registerStrictTool(
    server,
    "list_payment_drafts",
    "List payment drafts not yet sent for processing. Pass source:'all' " +
      "to include Revolut Business app drafts; omission preserves the API default. " +
      "A future-dated draft is not an approved scheduled payment. This list " +
      "does not establish the state of submitted payments or standing orders. " +
      "Read-only. Note: the list shows " +
      "id/scheduled_for/title/payments_count only — use get_payment_draft " +
      "for a draft's payment details.",
    {
      source: z.enum(["api", "integration", "email", "all"]).optional()
        .describe("Draft origin filter. all includes Business-app drafts; omitted uses Revolut's default API scope."),
    },
    READ_ONLY,
    async ({ source }) => {
      ctx.log("list_payment_drafts", { source });
      try {
        return ok(await ctx.client.listPaymentDrafts(source));
      } catch (error) {
        return fail(errorMessage(error));
      }
    },
  );

  registerStrictTool(
    server,
    "get_payment_draft",
    "Get a single payment draft by id, including its payments (amount, " +
      "currency, receiver, reference, state). Read-only.",
    {
      draft_id: z.string().guid().describe("Payment draft UUID"),
    },
    READ_ONLY,
    async ({ draft_id }) => {
      ctx.log("get_payment_draft", { draft_id });
      try {
        return ok(await ctx.client.getPaymentDraft(draft_id));
      } catch (error) {
        return fail(errorMessage(error));
      }
    },
  );
}
