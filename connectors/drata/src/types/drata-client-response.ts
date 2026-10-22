export interface DrataErrorResponse {
  isError: true;
  error: string;
  /** Drata's internal numeric code (from the response body's `code` field). */
  drataCode?: number;
  /** Drata's numeric message-code, when the body's `message` is a number. */
  drataMessageCode?: number;
  /** HTTP status code returned by Drata. */
  httpStatus?: number;
  /** Gated Drata feature name, for plan-gated (402) errors. */
  feature?: string;
  /** False for non-retryable conditions (e.g. plan-gated 402s). */
  retryable?: boolean;
  /** Remediation hint for known Drata error conditions. */
  hint?: string;
}

export type DrataClientResponse<T> =
  | { isError: false; result: T }
  | DrataErrorResponse;
