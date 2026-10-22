import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

/**
 * Default cap on events per call. Without one, default args would walk the
 * ENTIRE tenant audit log 300/page, which can paginate for many minutes on a
 * large tenant and produce a very large response — and every API call
 * appends to the log, so it grows while you read it. Events average ~1.2k
 * JSON chars with 18k+ outliers, so 50 keeps the default response
 * token-sane. A full walk is opt-in via an explicit large max_results plus
 * start_offset paging.
 */
const DEFAULT_AUDIT_MAX_RESULTS = 50;

export async function getAuditEvents(
  filters: { startDate?: string; endDate?: string } = {},
  maxResults?: number,
  startOffset?: number,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const params: Record<string, string> = {};
    if (filters.startDate) params.start_date = filters.startDate;
    if (filters.endDate) params.end_date = filters.endDate;

    const cap = maxResults ?? DEFAULT_AUDIT_MAX_RESULTS;
    const offset = startOffset ?? 0;
    const { events, hasMore } = await client.getAuditEvents(
      params,
      cap,
      offset,
    );
    return {
      isError: false,
      result: {
        returned: events.length,
        truncated: hasMore,
        ...(maxResults === undefined ? { default_cap_applied: cap } : {}),
        ...(hasMore
          ? {
              next_offset: offset + events.length,
              note: `More events exist upstream — this is a page, not the full log. Call again with start_offset: ${offset + events.length} (same filters) to continue, or narrow the window with start_date/end_date.`,
            }
          : {}),
        events,
      },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}
