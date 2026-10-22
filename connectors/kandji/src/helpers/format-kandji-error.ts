import {
  KandjiApiError,
  KandjiLicenseGatedError,
} from "../clients/kandji-client.js";

/**
 * Shared license-gating detector. The EDR and Vulnerability Management
 * handlers use it to fold a license-disabled tenant into the graceful
 * `{ count: 0, ..., license_gated: true }` shape instead of leaking a raw
 * 401/403/404.
 *
 *  - `KandjiLicenseGatedError`: both the v1 + v2 paths 404'd — the canonical
 *    "feature not licensed" signal for the dual-path EDR endpoints.
 *  - `KandjiApiError` 401/403/404: some tenants surface a hard auth failure or
 *    a 404 instead of the dual-404 dance (Vulnerability Management does this
 *    when the add-on isn't enabled).
 */
export function isLicenseGated(err: unknown): boolean {
  if (err instanceof KandjiLicenseGatedError) return true;
  if (err instanceof KandjiApiError) {
    return err.status === 401 || err.status === 403 || err.status === 404;
  }
  return false;
}

/**
 * Shared error formatter for handler catch blocks.
 *
 * Two problems this addresses:
 *   1. Without an HTTP status and a remediation hint, an LLM cannot reliably
 *      branch on 404 (bad ID → enumerate first) vs 401/403 (token scope / not
 *      licensed) vs 400 (payload), so failures carry a structured
 *      { error, status, hint }.
 *   2. Echoing the raw upstream response body (up to 2000 chars) into
 *      model-visible output would be an injection-amplification vector and a
 *      token sink. `KandjiApiError.message` is bounded and delimited as
 *      untrusted at the source (kandji-client.ts); the full body stays on the
 *      operator-facing `bodyText` field, which is never returned to the caller.
 */

/** Status-derived remediation hint, or undefined when none applies. */
export function hintForStatus(status: number): string | undefined {
  if (status === 404) {
    return "ID may be wrong or the resource does not exist; run the matching list_* tool to enumerate valid IDs.";
  }
  if (status === 401 || status === 403) {
    return "The KANDJI_API_TOKEN lacks the required scope, or the feature is not licensed for this tenant.";
  }
  if (status === 400 || status === 422) {
    return "The request payload was rejected; check required fields and value formats.";
  }
  if (status === 429) {
    return "Rate limited by the Kandji API; retry after a short wait.";
  }
  return undefined;
}

/**
 * Build the structured error half of a `KandjiClientResponse`. For a
 * `KandjiApiError` this attaches `status` and a `hint`; for anything else it
 * falls back to the plain message.
 */
export function formatKandjiError(err: unknown): {
  isError: true;
  error: string;
  status?: number;
  hint?: string;
} {
  if (err instanceof KandjiApiError) {
    const hint = hintForStatus(err.status);
    return {
      isError: true,
      // err.message is already status + path + bounded/delimited body.
      error: err.message,
      status: err.status,
      ...(hint ? { hint } : {}),
    };
  }
  return {
    isError: true,
    error: err instanceof Error ? err.message : String(err),
  };
}

/**
 * Render a handler's error response into the MCP tool `content` shape with a
 * status-class hint appended when present. Used by tool isError branches so
 * the LLM sees the HTTP status and remediation, not just a raw body string.
 */
export function renderToolError(response: {
  error: string;
  status?: number;
  hint?: string;
}): { isError: true; content: { type: "text"; text: string }[] } {
  const lines = [`Error: ${response.error}`];
  if (response.hint) lines.push(`Hint: ${response.hint}`);
  return {
    isError: true,
    content: [{ type: "text" as const, text: lines.join("\n") }],
  };
}
