/**
 * Cursor Team Admin API source.
 *
 * Spec: https://cursor.com/docs/account/teams/admin-api
 *
 * Endpoint used: POST https://api.cursor.com/teams/filtered-usage-events
 *   Auth: HTTP Basic with the admin API key as username and an empty password
 *         (Authorization: Basic <base64(KEY:)>).
 *   Body (JSON):
 *     startDate, endDate — epoch milliseconds
 *     page (1-indexed), pageSize
 *   Constraints:
 *     - Date range cannot exceed 30 days **per call**. The connector
 *       auto-chunks longer windows server-side; the user-facing surface
 *       has no 30-day cap.
 *     - 20 requests/minute per team rate limit
 *
 * `chargedCents` matches the `/teams/spend` dashboard total. We divide by
 * 100 to surface USD on CostLine.
 *
 * Per-engineer attribution (the central reason for wrapping Cursor):
 *   - When `userEmail` is set, group_by_value = userEmail.
 *   - When `userEmail` is null but `serviceAccountName` is set,
 *     group_by_value = "serviceAccount:<name>". Without this, spend from
 *     API-key / service-account requests lands under "(unknown user)";
 *     this attribution makes it addressable.
 *   - Otherwise group_by_value = "(unknown user)".
 */

import { Anomaly, CostLine, Source } from "../types/cost-line.js";
import { roundCurrency } from "../fx/fx.js";
import { sourceHttpError } from "../helpers/source-http-error.js";
import { ProbeResult, SourceModule } from "./source-module.js";

const SOURCE_NAME: Source = "cursor";
const ENDPOINT = "https://api.cursor.com/teams/filtered-usage-events";
const PAGE_SIZE = 1000;
/** Pagination safety cap per chunk — exhausting it with pages remaining THROWS. */
const MAX_PAGES = 200;
/** Cursor's per-call hard cap. Enforced by chunking, not by throwing. */
const MAX_RANGE_MS = 30 * 24 * 60 * 60 * 1000;

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const ALLOWED_GROUPS: ReadonlySet<string> = new Set(["user", "model", "kind"]);

interface UsageEvent {
  timestamp?: string;
  userEmail?: string | null;
  serviceAccountName?: string | null;
  model?: string;
  kind?: string;
  chargedCents?: number;
  isChargeable?: boolean;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheWriteTokens?: number;
    cacheReadTokens?: number;
    totalCents?: number;
  };
}

interface UsageEventsPage {
  totalUsageEventsCount?: number;
  pagination?: {
    numPages?: number;
    currentPage?: number;
    pageSize?: number;
    hasNextPage?: boolean;
    hasPreviousPage?: boolean;
  };
  usageEvents?: UsageEvent[];
}

export class CursorSource implements SourceModule {
  readonly name: Source = SOURCE_NAME;
  readonly requiredEnv: ReadonlyArray<string> = ["CURSOR_ADMIN_API_KEY"];
  private fetcher: Fetcher;

  constructor(fetcher?: Fetcher) {
    this.fetcher = fetcher ?? fetch;
  }

  isAvailable(): boolean {
    return Boolean(process.env.CURSOR_ADMIN_API_KEY);
  }

  private headers(): HeadersInit {
    const key = process.env.CURSOR_ADMIN_API_KEY ?? "";
    // Basic auth with API key as username, empty password.
    const token = Buffer.from(`${key}:`, "utf-8").toString("base64");
    return {
      Authorization: `Basic ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  async getCostLines(
    start: Date,
    end: Date,
    groupBy?: string,
  ): Promise<CostLine[]> {
    if (!this.isAvailable()) return [];
    const span = end.getTime() - start.getTime();
    if (span <= MAX_RANGE_MS) {
      return this.fetchChunk(start, end, groupBy);
    }
    // Auto-chunk into ≤30-day slices. Chunks are non-overlapping by 1ms — the
    // Cursor admin API contract on inclusivity at the bounds isn't documented,
    // so we pessimistically assume both bounds inclusive and offset the next
    // chunk by 1ms to avoid double-counting an event landing exactly on a
    // boundary millisecond.
    const collected: CostLine[] = [];
    let chunkStart = start;
    while (chunkStart.getTime() < end.getTime()) {
      const chunkEnd = new Date(
        Math.min(chunkStart.getTime() + MAX_RANGE_MS, end.getTime()),
      );
      const chunkLines = await this.fetchChunk(chunkStart, chunkEnd, groupBy);
      collected.push(...chunkLines);
      if (chunkEnd.getTime() >= end.getTime()) break;
      chunkStart = new Date(chunkEnd.getTime() + 1);
    }
    return collected;
  }

  private async fetchChunk(
    start: Date,
    end: Date,
    groupBy?: string,
  ): Promise<CostLine[]> {
    const groupAxis =
      groupBy && ALLOWED_GROUPS.has(groupBy) ? groupBy : undefined;
    const buckets = new Map<
      string,
      {
        period_start: string;
        period_end: string;
        group_by_value?: string;
        cents: number;
        sample: UsageEvent;
      }
    >();

    let page = 1;
    for (;;) {
      const body = JSON.stringify({
        startDate: start.getTime(),
        endDate: end.getTime(),
        page,
        pageSize: PAGE_SIZE,
      });
      const response = await this.fetcher(ENDPOINT, {
        method: "POST",
        headers: this.headers(),
        body,
      });
      if (!response.ok) {
        throw sourceHttpError(
          "Cursor filtered-usage-events",
          response.status,
          "CURSOR_ADMIN_API_KEY",
          await response.text().catch(() => ""),
        );
      }
      const json = (await response.json()) as UsageEventsPage;
      for (const event of json.usageEvents ?? []) {
        const cents = Number(event.chargedCents ?? 0);
        if (!Number.isFinite(cents)) continue;
        const tsMs = parseEventTimestamp(event.timestamp);
        if (tsMs === null) continue;
        const day = new Date(tsMs);
        day.setUTCHours(0, 0, 0, 0);
        const periodStart = day.toISOString();
        const periodEnd = new Date(
          day.getTime() + 24 * 60 * 60 * 1000,
        ).toISOString();
        const groupValue = groupAxis
          ? extractGroupValue(event, groupAxis)
          : undefined;
        const key = `${periodStart}|${groupValue ?? ""}`;
        const slot = buckets.get(key);
        if (slot) {
          slot.cents += cents;
        } else {
          buckets.set(key, {
            period_start: periodStart,
            period_end: periodEnd,
            group_by_value: groupValue,
            cents,
            sample: event,
          });
        }
      }
      if (!json.pagination?.hasNextPage) break;
      // Cap exhausted with pages remaining: throw rather than silently
      // returning truncated totals (which day padding would then disguise
      // as $0.00 days).
      if (page >= MAX_PAGES) {
        throw new Error(
          `Cursor filtered-usage-events: pagination safety cap exhausted ` +
            `(${MAX_PAGES} pages) with more pages remaining — ` +
            `totals would be truncated; narrow the requested window`,
        );
      }
      page += 1;
    }

    const lines: CostLine[] = [];
    for (const slot of buckets.values()) {
      lines.push({
        source: SOURCE_NAME,
        period_start: slot.period_start,
        period_end: slot.period_end,
        amount_usd: roundCurrency(slot.cents / 100),
        group_by_field: groupAxis,
        group_by_value: slot.group_by_value,
        raw: { sample_event: slot.sample },
      });
    }
    lines.sort((a, b) =>
      a.period_start === b.period_start
        ? (a.group_by_value ?? "").localeCompare(b.group_by_value ?? "")
        : a.period_start.localeCompare(b.period_start),
    );
    return lines;
  }

  async getAnomalies(_windowDays: number): Promise<Anomaly[]> {
    void _windowDays;
    return [];
  }

  async getForecastToMonthEnd(): Promise<CostLine | null> {
    return null;
  }

  async probe(): Promise<ProbeResult> {
    if (!this.isAvailable()) return { reachable: false, error: "no credentials" };
    // Probe via the same endpoint cost queries use — POST with a 24h window
    // and pageSize=1. GET /teams 404s on some tenants while the cost endpoint
    // works against the same credentials; reaching the cost endpoint is the
    // only thing that actually tells us spend-fetches will succeed.
    const end = Date.now();
    const start = end - 24 * 60 * 60 * 1000;
    try {
      const response = await this.fetcher(ENDPOINT, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          startDate: start,
          endDate: end,
          page: 1,
          pageSize: 1,
        }),
      });
      if (!response.ok) {
        return { reachable: false, error: `HTTP ${response.status}` };
      }
      return { reachable: true };
    } catch (err) {
      return {
        reachable: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/**
 * Parse a Cursor usage-event timestamp. The Cursor admin docs aren't explicit
 * about the wire format; observed values are millisecond-epoch numbers
 * (sometimes string-encoded). Accept both forms, plus ISO 8601 as a
 * defensive fallback so a format change at the upstream doesn't silently
 * drop every event.
 */
function parseEventTimestamp(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === "string") {
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;
    const asDate = new Date(raw).getTime();
    return Number.isFinite(asDate) && asDate > 0 ? asDate : null;
  }
  return null;
}

function extractGroupValue(
  event: UsageEvent,
  axis: string,
): string | undefined {
  switch (axis) {
    case "user":
      if (event.userEmail) return event.userEmail;
      if (event.serviceAccountName) {
        return `serviceAccount:${event.serviceAccountName}`;
      }
      return "(unknown user)";
    case "model":
      return event.model ?? "(unknown model)";
    case "kind":
      return event.kind ?? "(unknown kind)";
    default:
      return undefined;
  }
}
