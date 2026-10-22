import { DrataApiError } from "../clients/drata-client.js";
import { featureForPath } from "./entitlements.js";

/**
 * Map an exception thrown by the Drata client into a friendly response.
 *
 * Drata returns 402 with a JSON body like
 *   { statusCode: 402, message: "You must upgrade your plan...", code: 10740 }
 * for paid-plan-gated endpoints (Risk Management, Custom Connections, ...). A
 * 402 is an *account/plan entitlement* failure — not retryable, and distinct
 * from 403 (token permission). We surface the upstream message verbatim plus
 * the gated feature name and the base-tier alternative, so an LLM caller stops
 * retrying and reaches for the right tool.
 *
 * Some error bodies also carry a bare numeric `message` (a Drata internal
 * message-code, e.g. 404 → message: 15005). We translate those to human text.
 */
export interface MappedDrataError {
  isError: true;
  error: string;
  /** Drata's internal numeric code, when surfaced in the error body. */
  drataCode?: number;
  /** Drata's numeric message-code, when the body's `message` is a number. */
  drataMessageCode?: number;
  /** HTTP status from Drata, when extractable from the message. */
  httpStatus?: number;
  /** Gated Drata feature name, for 402s. */
  feature?: string;
  /** False for non-retryable conditions (e.g. plan-gated 402s). */
  retryable?: boolean;
  /** Remediation hint for known Drata error codes. */
  hint?: string;
}

const DRATA_ERROR_HINTS: Record<number, string> = {
  10000:
    "Templated evidence guard: templated evidence details are immutable; use a minimal artifact/owner/renewal update.",
  10010:
    "Drata server error. Retry with a minimal payload; after two identical failures treat it as upstream and use the evidence-library route where applicable.",
  10020:
    "Validation error. Check exact request field names and strip wrapper-only fields before sending.",
  10120:
    "Authentication or permission issue. Verify the API key, region host, and required Drata permissions.",
  10170:
    "Not found. Verify the object ID; use the corresponding list tool (e.g. list_vendor_security_reviews, list_audits) to discover valid IDs.",
  17015:
    "RISK_NOT_FOUND blames the risk id, but upstream returns this same error when the risk exists and riskRegisterId points at a wrong/nonexistent register. Verify riskRegisterId (list_risk_registers; commonly 1) before concluding the risk does not exist.",
};

// Drata `message`-codes seen as bare integers in error bodies. These are
// distinct from the top-level `code`. Map the ones we have observed; unknown
// codes fall back to a generic "Drata message code N" string.
const DRATA_MESSAGE_CODES: Record<number, string> = {
  15005:
    "Resource not found. Verify the ID exists in this workspace (for tasks, list_tasks / list_upcoming_tasks return current task IDs).",
  17003:
    "Feature not enabled for this account (HTTP 403, Drata message code 17003). This is plan/permission gating — e.g. the control library requires the Custom Frameworks feature — not an API-key or network problem, so retrying will not help. Contact your Drata CSM to enable the feature.",
};

function describeMessageCode(code: number, httpStatus?: number): string {
  const known = DRATA_MESSAGE_CODES[code];
  if (known) return known;
  const prefix = httpStatus ? `HTTP ${httpStatus}: ` : "";
  return `${prefix}Drata message code ${code}.`;
}

/** Pull `{path}` out of `Drata( V2)? API error <status> on <path>: <body>`. */
function extractPath(raw: string): string | undefined {
  const match = raw.match(/ on (\/[^\s:]+)(?::|\s|$)/);
  return match?.[1];
}

export function mapDrataError(err: unknown): MappedDrataError {
  const raw = err instanceof Error ? err.message : String(err);
  // Client HTTP errors carry status/path/body as typed fields; use those.
  // Anything else (plain Errors from other code paths) falls back to parsing
  // the message.
  const apiError = err instanceof DrataApiError ? err : undefined;

  // Fallback message formats: `Drata V2 API error <status> on <path>: <body>`,
  // and form/upload helpers' `<label> <status> on <path>: <body>`. Match the
  // status by word boundary so both the `<status>:` and `<status> on` forms work.
  let httpStatus: number | undefined = apiError?.status;
  if (!apiError) {
    const statusMatch =
      raw.match(/Drata( V2)? API error (\d{3})\b/) ??
      raw.match(/\b(?:error|upload error|create error|request error) (\d{3})\b/i);
    httpStatus = statusMatch ? Number(statusMatch[2] ?? statusMatch[1]) : undefined;
  }

  // Recover Drata's numeric `code` and `message` from the JSON body.
  let drataCode: number | undefined;
  let drataMessageCode: number | undefined;
  let bodyMessage: string | undefined;
  const jsonSource = apiError ? apiError.body : raw;
  const jsonStart = jsonSource.indexOf("{");
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(jsonSource.slice(jsonStart));
      if (typeof parsed?.code === "number") drataCode = parsed.code;
      if (typeof parsed?.message === "number") {
        drataMessageCode = parsed.message;
      } else if (typeof parsed?.message === "string") {
        bodyMessage = parsed.message;
      }
    } catch {
      /* not JSON — ignore */
    }
  }

  if (httpStatus === 402) {
    const path = apiError ? apiError.path : extractPath(raw);
    const feature = path ? featureForPath(path) : undefined;
    const upstream = bodyMessage ?? "You must upgrade your plan to use this feature.";
    const featureName = feature?.featureName ?? "a paid Drata add-on";
    const error =
      `${upstream} This endpoint requires the Drata "${featureName}" feature — ` +
      `a plan/account entitlement (HTTP 402), not a token-permission issue, so retrying will not help.` +
      (feature ? ` Base-tier alternative: ${feature.baseTierAlternative}.` : "");
    return {
      isError: true,
      error,
      ...(drataCode !== undefined && { drataCode }),
      httpStatus: 402,
      ...(feature && { feature: feature.featureName }),
      retryable: false,
      hint:
        "402 means the account's Drata plan does not include this feature. " +
        "Set DRATA_HIDE_UNENTITLED_TOOLS=true to drop these tools entirely, or upgrade the plan to restore them.",
    };
  }

  // A bare numeric `message` (e.g. 15005) is unreadable on its own — translate.
  // When the message-code has a known mapping it is authoritative; bodies with
  // numeric messages also carry the generic top-level code 10000, whose hint
  // (templated-evidence guard) would be misleading here, so suppress the
  // code-derived hint in that case.
  if (drataMessageCode !== undefined) {
    const messageCodeKnown = DRATA_MESSAGE_CODES[drataMessageCode] !== undefined;
    return {
      isError: true,
      error: describeMessageCode(drataMessageCode, httpStatus),
      ...(drataCode !== undefined && { drataCode }),
      drataMessageCode,
      ...(httpStatus !== undefined && { httpStatus }),
      ...(!messageCodeKnown && drataCode !== undefined && DRATA_ERROR_HINTS[drataCode]
        ? { hint: DRATA_ERROR_HINTS[drataCode] }
        : {}),
    };
  }

  return {
    isError: true,
    error: raw,
    ...(drataCode !== undefined && { drataCode }),
    ...(httpStatus !== undefined && { httpStatus }),
    ...(drataCode !== undefined && DRATA_ERROR_HINTS[drataCode]
      ? { hint: DRATA_ERROR_HINTS[drataCode] }
      : {}),
  };
}
