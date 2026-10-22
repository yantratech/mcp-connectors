/**
 * Discriminated-union return shape used by every handler. Mirrors the
 * sibling-connector convention (kandji, drata) so a future shared base layer
 * could be lifted out without rewrites.
 */
export type YantraSpendClientResponse<T> =
  | { isError: false; result: T }
  | { isError: true; error: string };
