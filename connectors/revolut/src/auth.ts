/**
 * Authentication: X509-cert-backed client-assertion JWT + OAuth
 * authorization-code flow with refresh tokens.
 *
 * Verified against https://developer.revolut.com/docs/guides/manage-accounts/get-started/make-your-first-api-request
 * on 2026-07-13:
 *   - Token endpoint: POST {base}/auth/token, application/x-www-form-urlencoded.
 *   - Assertion JWT: RS256, payload { iss, sub, aud: "https://revolut.com", exp }.
 *     `exp` MUST be a number (unix seconds) — the docs warn against a string.
 *   - Initial exchange returns access_token, token_type "bearer", expires_in
 *     (~2399s / 40 min), refresh_token. The refresh_token does NOT expire.
 *   - The refresh_token grant response does NOT include a new refresh_token, so
 *     we preserve the stored one. Refreshing invalidates the previous access
 *     token, hence the single-flight mutex below.
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import jwt from "jsonwebtoken";
import type { RevolutConfig } from "./config.js";

const CLIENT_ASSERTION_TYPE =
  "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

/** Refresh the access token this many ms before it actually expires. */
const REFRESH_SKEW_MS = 60_000;

/**
 * How to run the one-time code exchange, quoted in every error that sends the
 * operator back to it. `revolut-mcp-authorize` is this package's second bin;
 * from a source checkout, `npm run authorize -- <code>` runs the same script.
 */
export const AUTHORIZE_HINT =
  '"npx -y -p @yantratech/revolut-mcp-server revolut-mcp-authorize <code>" ' +
  '(from a source checkout: "npm run authorize -- <code>")';

export interface StoredTokens {
  refresh_token: string;
  access_token: string;
  /** Epoch milliseconds at which the access token expires. */
  access_token_expires_at: number;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

/** In-memory cache so we do not re-read the store on every API call. */
let cached: StoredTokens | null = null;

/**
 * Single-flight guard: refreshing invalidates the previous access token, so
 * concurrent callers must share ONE in-flight refresh rather than racing.
 */
let refreshInFlight: Promise<StoredTokens> | null = null;

/** Build a fresh short-lived RS256 client-assertion JWT. Never persisted. */
export function buildClientAssertion(config: RevolutConfig): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: config.jwtIss,
      sub: config.clientId,
      aud: "https://revolut.com",
      exp: nowSeconds + 300,
    },
    config.privateKey,
    { algorithm: "RS256" },
  );
}

async function postToken(
  config: RevolutConfig,
  params: Record<string, string>,
): Promise<TokenResponse> {
  const url = `${config.apiBaseUrl}/auth/token`;
  const body = new URLSearchParams({
    ...params,
    client_assertion_type: CLIENT_ASSERTION_TYPE,
    client_assertion: buildClientAssertion(config),
  });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();

  if (!response.ok) {
    // The body may carry { error, error_description } (OAuth) — surface it, but
    // never the assertion/token values.
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail =
        parsed.error_description ?? parsed.message ?? parsed.error ?? text;
    } catch {
      /* not JSON */
    }
    throw new Error(
      `Revolut token endpoint returned ${response.status}: ${detail}. ` +
        `The consent may have been revoked or the refresh token invalidated — ` +
        `re-run the consent flow (see README) and ${AUTHORIZE_HINT}.`,
    );
  }

  return JSON.parse(text) as TokenResponse;
}

export function readTokenStore(config: RevolutConfig): StoredTokens {
  let raw: string;
  try {
    raw = readFileSync(config.tokenStorePath, "utf8");
  } catch {
    throw new Error(
      `No token store at ${config.tokenStorePath}. Run the one-time consent ` +
        `flow and ${AUTHORIZE_HINT} to create it (see README).`,
    );
  }
  let parsed: Partial<StoredTokens>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Token store at ${config.tokenStorePath} is corrupt (not valid JSON). ` +
        `Re-run ${AUTHORIZE_HINT}.`,
    );
  }
  if (!parsed.refresh_token) {
    throw new Error(
      `Token store at ${config.tokenStorePath} is missing a refresh_token. ` +
        `Re-run ${AUTHORIZE_HINT}.`,
    );
  }
  return {
    refresh_token: parsed.refresh_token,
    access_token: parsed.access_token ?? "",
    access_token_expires_at: parsed.access_token_expires_at ?? 0,
  };
}

export function writeTokenStore(
  config: RevolutConfig,
  tokens: StoredTokens,
): void {
  const dir = dirname(config.tokenStorePath);
  mkdirSync(dir, { recursive: true });
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* best-effort: a pre-existing dir must not break auth */
  }
  // Write with mode 0600 from the start so the refresh token is never briefly
  // world-readable.
  writeFileSync(config.tokenStorePath, `${JSON.stringify(tokens, null, 2)}\n`, {
    mode: 0o600,
  });
  try {
    chmodSync(config.tokenStorePath, 0o600);
  } catch {
    /* best-effort */
  }
  cached = tokens;
}

/**
 * Exchange a fresh authorization code for tokens and persist the store.
 * Used only by the `authorize` CLI.
 */
export async function exchangeAuthorizationCode(
  config: RevolutConfig,
  code: string,
): Promise<StoredTokens> {
  const resp = await postToken(config, {
    grant_type: "authorization_code",
    code,
  });
  if (!resp.refresh_token) {
    throw new Error(
      "Revolut did not return a refresh_token on the authorization-code " +
        "exchange. The code may have expired (they are valid for 2 minutes) — " +
        "restart the consent flow and try again immediately.",
    );
  }
  const tokens: StoredTokens = {
    refresh_token: resp.refresh_token,
    access_token: resp.access_token,
    access_token_expires_at: Date.now() + resp.expires_in * 1000,
  };
  writeTokenStore(config, tokens);
  return tokens;
}

function loadCached(config: RevolutConfig): StoredTokens {
  if (!cached) cached = readTokenStore(config);
  return cached;
}

function isExpiringSoon(tokens: StoredTokens): boolean {
  return (
    !tokens.access_token ||
    Date.now() >= tokens.access_token_expires_at - REFRESH_SKEW_MS
  );
}

async function refresh(config: RevolutConfig): Promise<StoredTokens> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const current = loadCached(config);
      const resp = await postToken(config, {
        grant_type: "refresh_token",
        refresh_token: current.refresh_token,
      });
      const updated: StoredTokens = {
        // The refresh grant does not return a new refresh_token — keep ours.
        refresh_token: resp.refresh_token ?? current.refresh_token,
        access_token: resp.access_token,
        access_token_expires_at: Date.now() + resp.expires_in * 1000,
      };
      try {
        writeTokenStore(config, updated);
      } catch (error) {
        // The new token is already live (and the old one invalidated
        // server-side) — keep serving with it in memory even if persistence
        // fails, and surface the problem on stderr.
        cached = updated;
        process.stderr.write(
          `[revolut-mcp] warning: token store write failed: ` +
            `${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
      return updated;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * Return a valid access token, proactively refreshing when it is within the
 * skew window of expiry. Safe to call before every request.
 */
export async function getAccessToken(config: RevolutConfig): Promise<string> {
  let tokens = loadCached(config);
  if (isExpiringSoon(tokens)) tokens = await refresh(config);
  return tokens.access_token;
}

/**
 * Force a refresh. Used on a mid-flight 401: a single refresh is shared
 * across concurrent callers via the in-flight guard. Pass the token the
 * failing request used — if another caller already refreshed since then,
 * its token is reused rather than refreshed again (a second refresh would
 * invalidate the fresh token mid-use for whoever holds it).
 */
export async function forceRefreshAccessToken(
  config: RevolutConfig,
  staleToken?: string,
): Promise<string> {
  const current = cached;
  if (
    staleToken &&
    current?.access_token &&
    current.access_token !== staleToken &&
    !isExpiringSoon(current)
  ) {
    return current.access_token;
  }
  const tokens = await refresh(config);
  return tokens.access_token;
}

/** Test-only: drop the in-memory token cache. */
export function _resetTokenCacheForTests(): void {
  cached = null;
  refreshInFlight = null;
}
