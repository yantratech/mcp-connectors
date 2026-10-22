export type KandjiClientResponse<T> =
  | { isError: false; result: T }
  | {
      isError: true;
      /**
       * Human-readable, sanitized error message. For Kandji API failures this
       * leads with the HTTP status and a remediation hint, with any raw
       * upstream body bounded and clearly delimited as untrusted (see
       * `helpers/format-kandji-error.ts`).
       */
      error: string;
      /** Upstream HTTP status, when the failure was a `KandjiApiError`. */
      status?: number;
      /** Status-derived remediation hint, when one applies. */
      hint?: string;
    };
