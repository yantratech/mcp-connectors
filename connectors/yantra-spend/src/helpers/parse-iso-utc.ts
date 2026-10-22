/**
 * Parse an ISO-8601 string and force UTC. Date-only inputs (e.g. "2026-05-01")
 * become midnight UTC. Datetime inputs without a timezone are interpreted as
 * UTC (rather than local time) so date arithmetic is reproducible.
 *
 * Returns a Date and the canonical ISO-8601 string with millisecond resolution
 * and explicit `Z` suffix.
 */
export function parseIsoUtc(input: string): { date: Date; iso: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("date string is empty");
  }
  let candidate = trimmed;
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(candidate);
  if (isDateOnly) {
    candidate = `${candidate}T00:00:00Z`;
  } else if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(candidate)) {
    candidate = `${candidate}Z`;
  }
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid ISO-8601 datetime: ${input}`);
  }
  return { date, iso: date.toISOString() };
}

/** Format a Date as `YYYY-MM-DD` in UTC (some provider APIs require this). */
export function utcDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}
