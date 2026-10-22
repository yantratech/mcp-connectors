/**
 * Stringify an unknown error for handler responses. Strips substrings that
 * look like credentials so we never echo a key in a tool response or a log.
 *
 * Heuristic — any of:
 *   - sk-ant-admin-…   (Anthropic admin key)
 *   - sk-…             (OpenAI/Anthropic style)
 *   - key_…            (Cursor admin API key)
 *   - rk_live_… / sk_live_… / rk_test_… / sk_test_…  (Stripe restricted/secret)
 *   - JWT-like x.y.z   (three base64url segments)
 *   - AKIA[0-9A-Z]{16} (AWS access key id)
 *   - Authorization: Bearer/Basic <blob>  (header echoes, incl. base64 Basic)
 *   - 40-char base64-ish secrets (whitespace- or quote/=-delimited — e.g. a
 *     space-delimited AWS secret-access-key or Azure client secret)
 */
const REDACT_PATTERNS: ReadonlyArray<RegExp> = [
  // Header echoes first — redact the whole credential blob after the scheme,
  // including the base64(KEY:) Basic-auth blob the Cursor source builds.
  /\bAuthorization:\s*(?:Bearer|Basic)\s+\S+/gi,
  /\bsk-ant-admin-[A-Za-z0-9_-]+/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  // Cursor admin API key (key_<base64-ish>) — echoed verbatim in 401/403 bodies.
  /\bkey_[A-Za-z0-9]{20,}/g,
  /\b(?:rk|sk)_(?:live|test)_[A-Za-z0-9]{12,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  // Generic 40+ char high-entropy secret. No longer requires quote/=
  // delimiters — a secret can appear space-delimited (e.g. "secret <KEY>" in
  // an AWS/Azure SDK auth error). Bounded by whitespace, quotes, `=`, or
  // string ends so ordinary prose words (which are far shorter) don't match.
  /(?<=^|[\s"'=])[A-Za-z0-9/+_-]{40,}(?=$|[\s"'=])/g,
];

export function maskCredentials(text: string): string {
  let out = text;
  for (const pattern of REDACT_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

export function formatError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return maskCredentials(raw);
}
