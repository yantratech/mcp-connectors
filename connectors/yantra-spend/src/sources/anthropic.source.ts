/**
 * Anthropic admin API — cost report.
 *
 * Endpoint: GET /v1/organizations/cost_report
 *   Headers: x-api-key: <ANTHROPIC_ADMIN_KEY>, anthropic-version: 2023-06-01
 *   Query: starting_at (RFC 3339), bucket_width="1d", ending_at (RFC 3339, optional),
 *          group_by[] (one or both of "workspace_id" | "description"), limit, page
 *
 * Workaround: the ungrouped path (no group_by[]) intermittently 500s for
 * windows that cross midnight UTC. The grouped path always works. So:
 *   1. Send `group_by[]=workspace_id` even on the "ungrouped" code path; for
 *      windows the user requested without grouping, sum the workspace
 *      buckets locally back to a single line per day. This hits the working
 *      Anthropic shape consistently.
 *   2. On any 5xx response, retry exactly once with the same query.
 * As a result of step 1, the ungrouped figure matches what the Anthropic
 * dashboard shows for workspace-attributable spend, whereas the ungrouped
 * endpoint returned an inflated total.
 *
 * `amount` on each result is a decimal STRING in lowest currency units
 * (cents for USD). Divide by 100 at the boundary.
 *
 * Future-only windows: the API appears to clamp `ending_at` to the present
 * (observed in live testing), so a window that starts in the future becomes
 * a degenerate range and 400s ("ending date must be after starting date").
 * There can be no spend in such a window, so it returns no lines without
 * calling the API — the same empty result the other sources give, which
 * day-padding turns into zero lines. Windows that start in the past and end
 * in the future are sent as-is.
 */

import { Anomaly, CostLine, Source } from "../types/cost-line.js";
import { roundCurrency } from "../fx/fx.js";
import { sourceHttpError } from "../helpers/source-http-error.js";
import { ProbeResult, SourceModule } from "./source-module.js";

const SOURCE_NAME: Source = "anthropic";
const BASE_URL = "https://api.anthropic.com/v1/organizations/cost_report";
/**
 * `limit` = time buckets per page. For bucket_width="1d" the API default is
 * 7 and the maximum is 31 — request the max so the pagination safety cap
 * below covers ~3100 days (100 pages × 31 buckets) instead of ~700.
 */
const PAGE_LIMIT = 31;
/** Pagination safety cap — exhausting it with pages remaining THROWS. */
const MAX_PAGES = 100;

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type Clock = () => Date;

const ALLOWED_GROUPS: ReadonlySet<string> = new Set([
  "workspace_id",
  "description",
]);

interface CostReportResult {
  amount?: string;
  currency?: string;
  workspace_id?: string | null;
  description?: string | null;
  model?: string | null;
  service_tier?: string | null;
  token_type?: string | null;
  context_window?: string | null;
  cost_type?: string | null;
  inference_geo?: string | null;
}

interface CostReportBucket {
  starting_at?: string;
  ending_at?: string;
  results?: CostReportResult[];
}

interface CostReportPage {
  data?: CostReportBucket[];
  has_more?: boolean;
  next_page?: string | null;
}

export class AnthropicSource implements SourceModule {
  readonly name: Source = SOURCE_NAME;
  readonly requiredEnv: ReadonlyArray<string> = ["ANTHROPIC_ADMIN_KEY"];
  private fetcher: Fetcher;
  private now: Clock;

  constructor(fetcher?: Fetcher, now?: Clock) {
    this.fetcher = fetcher ?? fetch;
    this.now = now ?? (() => new Date());
  }

  isAvailable(): boolean {
    return Boolean(process.env.ANTHROPIC_ADMIN_KEY);
  }

  private headers(): HeadersInit {
    return {
      "x-api-key": process.env.ANTHROPIC_ADMIN_KEY ?? "",
      "anthropic-version": "2023-06-01",
      Accept: "application/json",
    };
  }

  async getCostLines(
    start: Date,
    end: Date,
    groupBy?: string,
  ): Promise<CostLine[]> {
    if (!this.isAvailable()) return [];

    // A window starting at or after "now" cannot contain spend, and the API
    // 400s on it (see the file header) — answer with no lines instead.
    if (start.getTime() >= this.now().getTime()) return [];

    if (groupBy === undefined) {
      // Ungrouped path — workaround the upstream 500 by always querying
      // workspace-grouped and collapsing to one line per day.
      const grouped = await this.fetchGrouped(start, end, "workspace_id");
      return collapseToDailyTotals(grouped);
    }

    if (!ALLOWED_GROUPS.has(groupBy)) {
      // Defensive: shouldn't reach here when the spend_by_source handler
      // validates against GROUP_BY_ALLOWLIST, but pass through cleanly if it
      // does (no rows).
      return [];
    }

    return this.fetchGrouped(
      start,
      end,
      groupBy as "workspace_id" | "description",
    );
  }

  private async fetchGrouped(
    start: Date,
    end: Date,
    groupBy: "workspace_id" | "description",
  ): Promise<CostLine[]> {
    const baseParams = new URLSearchParams({
      starting_at: start.toISOString(),
      ending_at: end.toISOString(),
      bucket_width: "1d",
      limit: String(PAGE_LIMIT),
    });
    baseParams.append("group_by[]", groupBy);

    const lines: CostLine[] = [];
    let pageToken: string | null = null;
    let pagesFetched = 0;
    for (;;) {
      const params = new URLSearchParams(baseParams);
      if (pageToken) params.set("page", pageToken);
      const url = `${BASE_URL}?${params.toString()}`;
      const response = await this.fetchWithOneRetryOn5xx(url);
      if (!response.ok) {
        throw sourceHttpError(
          "Anthropic cost_report",
          response.status,
          "ANTHROPIC_ADMIN_KEY",
          await response.text().catch(() => ""),
        );
      }
      const page = (await response.json()) as CostReportPage;
      pagesFetched += 1;
      for (const bucket of page.data ?? []) {
        const ps = bucket.starting_at
          ? normaliseIso(bucket.starting_at)
          : start.toISOString();
        const pe = bucket.ending_at
          ? normaliseIso(bucket.ending_at)
          : end.toISOString();
        for (const result of bucket.results ?? []) {
          const usd = parseAmountCentsToUsd(result.amount, result.currency);
          if (usd === null) continue;
          const groupValue = extractGroupValue(result, groupBy);
          lines.push({
            source: SOURCE_NAME,
            period_start: ps,
            period_end: pe,
            amount_usd: roundCurrency(usd),
            group_by_field: groupBy,
            group_by_value: groupValue ?? undefined,
            raw: result as unknown as Record<string, unknown>,
          });
        }
      }
      if (!page.has_more || !page.next_page) break;
      // Cap exhausted with pages remaining: throw rather than silently
      // returning truncated totals (which day padding would then disguise
      // as $0.00 days).
      if (pagesFetched >= MAX_PAGES) {
        throw new Error(
          `Anthropic cost_report: pagination safety cap exhausted ` +
            `(${MAX_PAGES} pages) with more pages remaining — ` +
            `totals would be truncated; narrow the requested window`,
        );
      }
      pageToken = page.next_page;
    }
    return lines;
  }

  /**
   * Single retry on 5xx — Anthropic's cost_report endpoint occasionally 500s
   * on requests that span midnight UTC. The retry hits the same URL once.
   */
  private async fetchWithOneRetryOn5xx(url: string): Promise<Response> {
    const headers = this.headers();
    const first = await this.fetcher(url, { headers });
    if (first.status >= 500 && first.status < 600) {
      // Discard the body so the connection can release.
      try {
        await first.text();
      } catch {
        // ignore
      }
      return await this.fetcher(url, { headers });
    }
    return first;
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
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({
      starting_at: start.toISOString(),
      ending_at: end.toISOString(),
      bucket_width: "1d",
    });
    params.append("group_by[]", "workspace_id");
    try {
      const response = await this.fetcher(`${BASE_URL}?${params.toString()}`, {
        headers: this.headers(),
      });
      if (!response.ok) {
        return {
          reachable: false,
          error: `HTTP ${response.status}`,
        };
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

function parseAmountCentsToUsd(
  amount: string | undefined,
  currency: string | undefined,
): number | null {
  if (amount === undefined || amount === null) return null;
  if (currency && currency.toUpperCase() !== "USD") {
    // Anthropic bills USD-only today, so this should never fire — but if a
    // non-USD line ever appears, silently dropping it (the old behavior)
    // would understate spend with no signal. Fail loudly instead; the
    // handlers surface this as a source error/warning.
    throw new Error(
      `anthropic: unsupported currency '${currency}' in cost report — ` +
        "only USD is supported; refusing to silently drop the line",
    );
  }
  const cents = Number(amount);
  if (!Number.isFinite(cents)) return null;
  return cents / 100;
}

function extractGroupValue(
  result: CostReportResult,
  groupBy: string,
): string | undefined {
  switch (groupBy) {
    case "workspace_id":
      return result.workspace_id ?? "(default workspace)";
    case "description":
      return result.description ?? undefined;
    default:
      return undefined;
  }
}

/**
 * Collapse workspace-grouped lines back to one line per day, dropping the
 * group_by_field/value fields. Used by the ungrouped path.
 */
function collapseToDailyTotals(grouped: CostLine[]): CostLine[] {
  const byDay = new Map<
    string,
    { period_start: string; period_end: string; sum: number; raws: unknown[] }
  >();
  for (const line of grouped) {
    const slot = byDay.get(line.period_start);
    if (slot) {
      slot.sum += line.amount_usd;
      if (line.raw) slot.raws.push(line.raw);
    } else {
      byDay.set(line.period_start, {
        period_start: line.period_start,
        period_end: line.period_end,
        sum: line.amount_usd,
        raws: line.raw ? [line.raw] : [],
      });
    }
  }
  const out: CostLine[] = [];
  for (const slot of byDay.values()) {
    out.push({
      source: SOURCE_NAME,
      period_start: slot.period_start,
      period_end: slot.period_end,
      amount_usd: roundCurrency(slot.sum),
      // Preserve the underlying workspace-grouped raws so include_raw=true
      // still surfaces the per-workspace breakdown that the daily total was
      // collapsed from. Stripped at the handler when include_raw is false.
      raw: { collapsed_from_workspace_groups: slot.raws },
    });
  }
  out.sort((a, b) => a.period_start.localeCompare(b.period_start));
  return out;
}

/**
 * Coerce any ISO-8601 string to canonical millisecond + Z form.
 * "2026-05-01T00:00:00Z" → "2026-05-01T00:00:00.000Z".
 */
function normaliseIso(raw: string): string {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toISOString();
}
