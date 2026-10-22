import {
  getKandjiClient,
  PRISM_CATEGORIES,
} from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

/**
 * /prism/count is per-category; the tool description promises counts across
 * ALL categories, so fan out and aggregate.
 *
 * Each per-category response shape varies (`count`, `total`, or a number) so
 * we coerce defensively. A failed category becomes null in the map and is
 * also surfaced under `errors` rather than failing the whole call — a stale
 * category server-side shouldn't poison the rest.
 */
export async function getPrismCount(): Promise<
  KandjiClientResponse<{
    counts: Record<string, number | null>;
    errors?: Record<string, string>;
  }>
> {
  try {
    const client = getKandjiClient();
    const settled = await Promise.allSettled(
      PRISM_CATEGORIES.map((c) => client.getPrismCount(c)),
    );

    const counts: Record<string, number | null> = {};
    const errors: Record<string, string> = {};

    settled.forEach((res, idx) => {
      const category = PRISM_CATEGORIES[idx]!;
      if (res.status === "fulfilled") {
        counts[category] = coerceCount(res.value);
      } else {
        counts[category] = null;
        errors[category] =
          res.reason instanceof Error ? res.reason.message : String(res.reason);
      }
    });

    const result: { counts: typeof counts; errors?: typeof errors } = {
      counts,
    };
    if (Object.keys(errors).length > 0) result.errors = errors;
    return { isError: false, result };
  } catch (err) {
    return formatKandjiError(err);
  }
}

function coerceCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["count", "total", "value"]) {
      const v = obj[key];
      if (typeof v === "number" && Number.isFinite(v)) return v;
    }
  }
  return null;
}
