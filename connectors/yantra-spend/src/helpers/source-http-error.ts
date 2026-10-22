/**
 * Build a bounded, remediation-hinted error message for a non-2xx upstream
 * HTTP response from a cost source (Anthropic / OpenAI / Cursor).
 *
 * Why this exists:
 *   The three raw-fetch sources used to throw `<provider> <status>: ${await
 *   response.text()}` — the *entire* raw body. That had two problems:
 *     1. SECURITY: a 401/403 body that reflects the submitted credential (or
 *        an SDK/proxy error that echoes the Authorization header) leaked the
 *        live key into the thrown error, which flows verbatim into
 *        client-facing tool output and logs. The body is the only place a
 *        reflected credential can come from — so we no longer paste it in
 *        un-bounded, and what we do keep is run through maskCredentials.
 *     2. UX: 5xx bodies are frequently multi-KB HTML/JSON, which bloats the
 *        warnings/error surfaced to the model and gives it no actionable
 *        remediation.
 *
 * This helper keeps only the status code, a status-class remediation hint,
 * and a short, credential-masked body excerpt.
 */
import { maskCredentials } from "./format-error.js";

/** Max chars of the upstream body we ever surface (post-mask). */
const BODY_EXCERPT_LIMIT = 200;

/**
 * Map an HTTP status to a short, actionable remediation hint. `envVar` names
 * the source's credential env var so auth failures point at the right knob.
 */
function remediationHint(status: number, envVar: string): string {
  if (status === 401 || status === 403) return `check ${envVar}`;
  if (status === 429) return "rate limited; retry or narrow the window";
  if (status >= 500) return "upstream error; retry";
  if (status >= 400) return "bad request; check the requested window/params";
  return "unexpected response";
}

/**
 * Build the thrown-error message for a non-2xx upstream response.
 *
 * `bodyText` is the already-read response body (callers pass `await
 * response.text()`). It is masked and truncated before inclusion — never
 * pasted verbatim. Pass an empty string if the body is unavailable.
 */
export function sourceHttpError(
  provider: string,
  status: number,
  envVar: string,
  bodyText: string,
): Error {
  const hint = remediationHint(status, envVar);
  const masked = maskCredentials(bodyText ?? "").trim();
  const excerpt =
    masked.length > BODY_EXCERPT_LIMIT
      ? `${masked.slice(0, BODY_EXCERPT_LIMIT)}…`
      : masked;
  const suffix = excerpt ? ` — ${excerpt}` : "";
  return new Error(`${provider} HTTP ${status} (${hint})${suffix}`);
}
