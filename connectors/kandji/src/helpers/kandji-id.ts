import { z } from "zod";

/**
 * Kandji resource IDs (device, blueprint, library item, tag, note, user, ADE
 * token, Prism export, CVE, …) are interpolated into URL PATHS. A raw ID that
 * carries a separator or a dot segment rewrites the request target:
 *
 *   get_device("abc/secrets/filevaultkey")  → GET    /devices/abc/secrets/filevaultkey
 *   delete_tag("../blueprints/X")           → DELETE /blueprints/X
 *
 * `encodeURIComponent` alone is not enough: it leaves `.` and `..` untouched,
 * and the WHATWG URL parser (used by fetch) collapses them — including their
 * percent-encoded forms `%2e` / `%2E`. So every ID is validated as a single,
 * inert path segment BEFORE it is encoded, and anything that could act as a
 * separator, dot segment, query/fragment delimiter or pre-encoded byte is
 * refused outright rather than "cleaned".
 */

/** Loose 8-4-4-4-12 hex UUID. Kandji IDs do not always carry RFC 4122/9562
 *  version and variant bits, so the strict `z.uuid()` would reject real IDs. */
export const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Upper bound on an ID's length: far above any real Kandji ID, low enough
 *  that an oversized value cannot be used to bloat the request line. */
export const MAX_ID_LENGTH = 256;

/** Stable phrase that prefixes every rejection, so callers and tests can
 *  recognise this guard's errors. */
export const INVALID_ID_MESSAGE = "is not a valid Kandji ID";

// C0 controls, DEL, C1 controls.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Returns why `value` is unsafe as a single URL path segment, or null when it
 * is safe. Rejected: non-strings, empty strings, `.` and `..`, `/` and `\`,
 * `?` and `#`, any `%` (so pre-encoded separators and dot segments such as
 * `%2f`, `%5c`, `%2e%2e` and double-encoded `%252f` can never reach the URL
 * parser), control characters, lone UTF-16 surrogates, surrounding
 * whitespace, and anything longer
 * than MAX_ID_LENGTH.
 */
export function idProblem(value: unknown): string | null {
  if (typeof value !== "string") return "must be a string";
  if (value.length === 0) return "must not be empty";
  if (value.length > MAX_ID_LENGTH) {
    return `must be at most ${MAX_ID_LENGTH} characters`;
  }
  if (value === "." || value === "..") return "must not be a dot segment";
  if (/[/\\]/.test(value)) return "must not contain '/' or '\\'";
  if (/[?#]/.test(value)) return "must not contain '?' or '#'";
  if (value.includes("%")) {
    return "must not contain '%' (pre-encoded characters are not accepted)";
  }
  if (CONTROL_CHARS.test(value)) return "must not contain control characters";
  // A lone surrogate would make encodeURIComponent throw a bare URIError.
  if (LONE_SURROGATE.test(value)) return "must be well-formed Unicode";
  if (value.trim() !== value) {
    return "must not have leading or trailing whitespace";
  }
  return null;
}

/** Thrown by `encodeId` when an ID is not a safe single path segment. */
export class InvalidKandjiIdError extends Error {
  constructor(
    public readonly label: string,
    public readonly reason: string,
  ) {
    super(`${label} ${INVALID_ID_MESSAGE}: it ${reason}.`);
    this.name = "InvalidKandjiIdError";
  }
}

/**
 * Validate `value` as a single path segment, then percent-encode it. Use this
 * at EVERY place an ID (or any other caller-influenced value) is interpolated
 * into a request path. Throws `InvalidKandjiIdError`, before any network I/O,
 * when the value is unsafe.
 */
export function encodeId(value: string, label = "id"): string {
  const problem = idProblem(value);
  if (problem !== null) throw new InvalidKandjiIdError(label, problem);
  return encodeURIComponent(value);
}

/**
 * Zod schema for an opaque Kandji ID (any format the API accepts, e.g. legacy
 * integer user IDs, CVE identifiers, Prism export IDs) that is safe as a
 * single path segment. The client re-checks with `encodeId`, so this is the
 * early, model-visible rejection rather than the only line of defence.
 */
export const KandjiId = z.string().superRefine((value, ctx) => {
  const problem = idProblem(value);
  if (problem !== null) {
    ctx.addIssue({
      code: "custom",
      message: `${INVALID_ID_MESSAGE}: it ${problem}`,
    });
  }
});

/**
 * Like `KandjiId`, but also accepts `""`. For optional QUERY filters and BODY
 * fields that accepted an empty string before this guard existed (agents often
 * send `""` to mean "no filter"; handlers and `withQuery` drop it). Never use
 * this for an ID that is interpolated into a path.
 */
export const KandjiFilterId = z.string().superRefine((value, ctx) => {
  if (value === "") return;
  const problem = idProblem(value);
  if (problem !== null) {
    ctx.addIssue({
      code: "custom",
      message: `${INVALID_ID_MESSAGE}: it ${problem}`,
    });
  }
});

/**
 * Zod schema for Kandji IDs the API documents as UUIDs (device, blueprint,
 * library item, tag). Same path-segment safety as `KandjiId`, plus the loose
 * UUID shape, which is also advertised to clients as a JSON-schema `pattern`.
 */
export const KandjiUuid = KandjiId.regex(UUID_RE, {
  message: `${INVALID_ID_MESSAGE}: expected a UUID such as 3fa85f64-5717-4562-b3fc-2c963f66afa6`,
});
