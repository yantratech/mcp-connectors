import { AxiosError } from "axios";

/**
 * Format error messages in a user-friendly way
 */
export function formatError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status;
    const detail = error.response?.data?.Detail;

    switch (status) {
      case 401:
        return "Authentication failed. Please check your Xero credentials.";
      case 403:
        return "You don't have permission to access this resource in Xero.";
      case 404:
        return "The requested resource was not found in Xero.";
      case 429:
        return "Too many requests to Xero. Please try again in a moment.";
      default: {
        const fieldErrors = error.response?.data?.fieldValidationErrors;
        if (Array.isArray(fieldErrors) && fieldErrors.length > 0) {
          const msgs = fieldErrors.map(
            (e: { fieldName?: string; localisedMessage?: string }) =>
              `${e.fieldName}: ${e.localisedMessage}`,
          );
          return `Xero validation error: ${msgs.join("; ")}`;
        }
        return detail || "An error occurred while communicating with Xero.";
      }
    }
  }
  // xero-node (non-axios paths) throws either plain objects shaped
  // { response: { statusCode, body, headers } } or that same structure
  // JSON-serialised as a string (varies by endpoint). Normalise both and
  // surface status + body, never the headers blob.
  const resp = extractXeroResponse(error);
  {
    if (resp && typeof resp.statusCode === "number") {
      switch (resp.statusCode) {
        case 401:
          return "Authentication failed. Please check your Xero credentials.";
        case 403:
          return "You don't have permission to access this resource in Xero.";
        case 404:
          return "The requested resource was not found in Xero.";
        case 429:
          return "Too many requests to Xero. Please try again in a moment.";
        default: {
          const body =
            typeof resp.body === "string" ? resp.body : JSON.stringify(resp.body);
          return `Xero API error ${resp.statusCode}: ${body}`;
        }
      }
    }
  }
  return error instanceof Error
    ? error.message
    : `An unexpected error occurred: ${typeof error === "object" ? JSON.stringify(error) : String(error)}`;
}

/**
 * Normalises xero-node's two throw shapes — a plain object with a `response`
 * field, or the same structure JSON-serialised into a string — into the
 * `{ statusCode, body }` response, or undefined if the error matches neither.
 */
export function extractXeroResponse(
  error: unknown,
): { statusCode?: number; body?: unknown } | undefined {
  let candidate: unknown = error;
  if (typeof candidate === "string" && candidate.trimStart().startsWith("{")) {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return undefined;
    }
  }
  if (candidate && typeof candidate === "object" && "response" in candidate) {
    const resp = (candidate as { response?: unknown }).response;
    if (resp && typeof resp === "object") {
      return resp as { statusCode?: number; body?: unknown };
    }
  }
  return undefined;
}
