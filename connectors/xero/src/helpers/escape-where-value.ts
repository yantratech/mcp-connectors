/**
 * Escapes a free-text value for safe interpolation into a string literal of
 * a Xero `where` filter (e.g. `Reference=="<value>"`).
 *
 * Unescaped backslashes and double quotes would terminate the string literal
 * early, producing a malformed query (or letting the value alter the filter),
 * so both are backslash-escaped.
 *
 * Use this only for free-text values. Identifiers (GUIDs) and enum values
 * should be validated against their expected format instead.
 */
export const escapeWhereValue = (value: string): string => {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
};
