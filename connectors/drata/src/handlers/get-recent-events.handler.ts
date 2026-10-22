import { getDrataClient } from "../clients/drata-client.js";
import { mapDrataError } from "../helpers/error-mapping.js";
import type { DrataClientResponse } from "../types/drata-client-response.js";

// Drata caps /public/events at limit=50; values above 50 return HTTP 400.
const EVENTS_LIMIT_CAP = 50;

export async function getRecentEvents(
  limit: number = 20,
): Promise<DrataClientResponse<unknown>> {
  try {
    // Coerce NaN/non-finite inputs (e.g. accidental Number.NaN) to the
    // default — Math.max/min would otherwise propagate NaN unmodified.
    const candidate = Number.isFinite(limit) ? limit : 20;
    const safeLimit = Math.max(1, Math.min(candidate, EVENTS_LIMIT_CAP));
    const clamped = candidate > EVENTS_LIMIT_CAP;
    const client = getDrataClient();
    const events = await client.getRecentEvents(safeLimit);

    // The upstream envelope's `total` is a sentinel (9999999), so the only
    // honest continuation signal is "we filled the page".
    const hasMore = events.length >= safeLimit;
    const notes: string[] = [];
    if (clamped) {
      notes.push(
        `limit ${candidate} was clamped to ${EVENTS_LIMIT_CAP} (upstream maximum).`,
      );
    }
    if (hasMore) {
      notes.push(
        `Only the newest ${events.length} events are shown — the audit trail continues. Use list_events_v2 (cursor pagination, since filter) for complete history.`,
      );
    }

    return {
      isError: false,
      result: {
        count: events.length,
        limit: safeLimit,
        hasMore,
        ...(notes.length > 0 && { note: notes.join(" ") }),
        events: events.map((e) => ({
          id: e.id,
          type: e.type,
          category: e.category,
          // Upstream result status: PASSED/FAILED/ERROR for check events,
          // null for non-check activity. Without it the static `description`
          // reads as an assertion that the check succeeded.
          status: e.status ?? null,
          description: e.description,
          source: e.source,
          createdAt: e.createdAt,
          user: e.user
            ? `${e.user.firstName} ${e.user.lastName}`
            : null,
        })),
      },
    };
  } catch (err) {
    return mapDrataError(err);
  }
}
