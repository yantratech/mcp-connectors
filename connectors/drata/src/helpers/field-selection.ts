export function normalizeCodes(codes?: string[]): Set<string> | undefined {
  const normalized = codes
    ?.map((code) => code.trim().toUpperCase())
    .filter(Boolean);
  return normalized && normalized.length > 0 ? new Set(normalized) : undefined;
}

export function matchesCode(
  record: { code?: unknown },
  codes?: Set<string>,
): boolean {
  if (!codes) return true;
  return codes.has(String(record.code ?? "").trim().toUpperCase());
}

export function pickFields<T extends Record<string, unknown>>(
  record: T,
  fields?: string[],
): Record<string, unknown> {
  if (!fields || fields.length === 0) return record;
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      picked[field] = record[field];
    }
  }
  return picked;
}

export function projectFields<T extends Record<string, unknown>>(
  records: T[],
  fields?: string[],
): Record<string, unknown>[] {
  return records.map((record) => pickFields(record, fields));
}
