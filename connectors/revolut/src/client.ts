/**
 * Thin Revolut Business REST client over Node's built-in fetch.
 *
 * - Injects `Authorization: Bearer <access_token>` on every request, refreshing
 *   proactively (see auth.ts) and once more on a mid-flight 401.
 * - Retries a 429 exactly once, honouring Retry-After (falling back to 2s).
 * - 30s timeout per request.
 * - On a non-2xx, throws an Error whose message carries the HTTP status, the
 *   Revolut `message`/`code` if present, and the method + path — but NEVER the
 *   request body (it can contain payee references).
 *
 * Endpoint paths verified against the Business API reference on 2026-07-13.
 * Note the deliberately SINGULAR single-resource paths: `/transaction/{id}`
 * and `/counterparty/{id}` (the list paths are plural).
 */
import {
  AUTHORIZE_HINT,
  forceRefreshAccessToken,
  getAccessToken,
} from "./auth.js";
import type { RevolutConfig } from "./config.js";

const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_AFTER_MS = 2_000;
/** Never honour a Retry-After longer than this — fail fast instead of hanging. */
const MAX_RETRY_AFTER_MS = 30_000;

export type QueryParams = Record<
  string,
  string | number | boolean | undefined
>;

export type PaymentDraftSource = "api" | "integration" | "email" | "all";

/** One payment inside a payment-draft create request. */
export interface DraftPayment {
  account_id: string;
  receiver: { counterparty_id: string; account_id?: string; card_id?: string };
  amount: number;
  currency: string;
  reference: string;
  transfer_reason_code?: string;
}

export interface CreatePaymentDraftBody {
  title: string;
  schedule_for?: string;
  payments: DraftPayment[];
}

function buildQuery(params?: QueryParams): string {
  if (!params) return "";
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    usp.append(key, String(value));
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

/**
 * A non-2xx answer from the Revolut API. `status` lets callers tell a real
 * "does not exist" (404) apart from auth, permission, rate-limit or server
 * failures, which must never be reported as "not found".
 */
export class RevolutApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "RevolutApiError";
    this.status = status;
  }
}

/** True only when `error` is a Revolut API 404. */
export function isNotFound(error: unknown): boolean {
  return error instanceof RevolutApiError && error.status === 404;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RevolutClient {
  constructor(private readonly config: RevolutConfig) {}

  private formatError(
    status: number,
    method: string,
    path: string,
    responseText: string,
  ): string {
    let detail = responseText;
    let code: number | string | undefined;
    try {
      const parsed = JSON.parse(responseText);
      detail =
        parsed.message ??
        parsed.error_description ??
        parsed.error ??
        responseText;
      code = parsed.code;
    } catch {
      /* response body is not JSON — use it verbatim */
    }
    const codePart = code !== undefined ? ` (code ${code})` : "";
    return `Revolut API error ${status} on ${method} ${path}: ${detail}${codePart}`;
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { query?: QueryParams; body?: unknown } = {},
  ): Promise<T> {
    const url = `${this.config.apiBaseUrl}${path}${buildQuery(opts.query)}`;
    const hasBody = opts.body !== undefined;
    let retried401 = false;
    let retried429 = false;

    while (true) {
      const accessToken = await getAccessToken(this.config);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      };
      if (hasBody) headers["Content-Type"] = "application/json";

      const response = await fetch(url, {
        method,
        headers,
        body: hasBody ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      // Always drain the body so the socket is released before any retry.
      const text = await response.text();

      // Mid-flight 401: refresh once and retry. Revolut returns
      // {"message":"The request should be authorized."} on an expired token.
      if (response.status === 401 && !retried401) {
        retried401 = true;
        try {
          await forceRefreshAccessToken(this.config, accessToken);
        } catch (error) {
          throw new Error(
            `Authentication failed and the token refresh also failed: ` +
              `${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
        continue;
      }

      if (response.status === 429 && !retried429) {
        retried429 = true;
        const retryAfter = response.headers.get("retry-after");
        const waitMs = retryAfter
          ? Math.min(MAX_RETRY_AFTER_MS, Math.max(0, Number(retryAfter) * 1000))
          : DEFAULT_RETRY_AFTER_MS;
        await sleep(Number.isFinite(waitMs) ? waitMs : DEFAULT_RETRY_AFTER_MS);
        continue;
      }

      if (!response.ok) {
        if (response.status === 401) {
          throw new RevolutApiError(
            401,
            `Revolut API error 401 on ${method} ${path}: still unauthorized ` +
              `after a token refresh. Re-run the consent flow (see README) and ${AUTHORIZE_HINT}.`,
          );
        }
        throw new RevolutApiError(
          response.status,
          this.formatError(response.status, method, path, text),
        );
      }

      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    }
  }

  // === Accounts ===
  listAccounts(): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/accounts");
  }

  getAccount(accountId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/accounts/${encodeURIComponent(accountId)}`,
    );
  }

  /** Returns an ARRAY of bank-detail objects (one per scheme/currency route). */
  getAccountBankDetails(accountId: string): Promise<unknown[]> {
    return this.request<unknown[]>(
      "GET",
      `/accounts/${encodeURIComponent(accountId)}/bank-details`,
    );
  }

  // === Transactions ===
  listTransactions(query: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/transactions", { query });
  }

  /** Singular path — verified against the docs. */
  getTransaction(transactionId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/transaction/${encodeURIComponent(transactionId)}`,
    );
  }

  // === Counterparties ===
  listCounterparties(query: QueryParams): Promise<unknown[]> {
    return this.request<unknown[]>("GET", "/counterparties", { query });
  }

  /** Singular path — verified against the docs. */
  getCounterparty(counterpartyId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/counterparty/${encodeURIComponent(counterpartyId)}`,
    );
  }

  // === Payment drafts (create is the ONLY write in this server) ===
  createPaymentDraft(
    body: CreatePaymentDraftBody,
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("POST", "/payment-drafts", {
      body,
    });
  }

  /**
   * List drafts not yet sent for processing. Omission preserves Revolut's
   * default API scope; source=all also includes Business-app drafts.
   * This endpoint is not an inventory of submitted scheduled payments.
   */
  listPaymentDrafts(source?: PaymentDraftSource): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", "/payment-drafts", {
      query: { source },
    });
  }

  getPaymentDraft(draftId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/payment-drafts/${encodeURIComponent(draftId)}`,
    );
  }
}
