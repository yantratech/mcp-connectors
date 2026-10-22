// Xero identifiers are 8-4-4-4-12 hex GUIDs. Version/variant nibbles are not
// checked: Xero issues IDs (and its docs use examples) that are not strict
// RFC 4122 UUIDs, matching zod's `.guid()` rather than `.uuid()`.
export const GUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Asserts that a caller-supplied id is a well-formed GUID before it is
 * interpolated into a guid("...") where-clause literal. The guid literal is
 * not a quoted string, so escapeWhereValue cannot make it safe; an invalid
 * value (e.g. one containing `")`) could otherwise inject filter conditions.
 *
 * The tool schemas already enforce `.guid()`; this is defence in depth for
 * handlers that are exported and callable without schema validation.
 */
export function assertGuid(value: string, field: string): string {
  if (!GUID_RE.test(value)) {
    throw new Error(`${field} must be a valid Xero GUID`);
  }
  return value;
}
