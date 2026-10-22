/**
 * OpenAI admin API — costs report.
 *
 * Endpoint: GET /v1/organization/costs
 *   Headers: Authorization: Bearer <OPENAI_ADMIN_KEY>, OpenAI-Organization: <OPENAI_ORG_ID> (optional)
 *   Query: start_time (unix seconds, required), end_time (unix seconds, optional),
 *          bucket_width ("1d" only currently),
 *          group_by[] (any of "project_id" | "line_item" | "api_key_id"),
 *          limit (1-180, default 7), page (cursor)
 *
 * `amount.value` is in USD dollars (NOT cents like Anthropic). `currency` is
 * lowercase ("usd"). The live API returns `value` as a high-precision
 * decimal STRING despite the docs typing it as `number` — the parser accepts
 * both forms.
 */

import { Anomaly, CostLine, Source } from "../types/cost-line.js";
import { roundCurrency } from "../fx/fx.js";
import { sourceHttpError } from "../helpers/source-http-error.js";
import { ProbeResult, SourceModule } from "./source-module.js";

const SOURCE_NAME: Source = "openai";
const BASE_URL = "https://api.openai.com/v1/organization/costs";
const PAGE_LIMIT = 180;
/** Pagination safety cap — exhausting it with pages remaining THROWS. */
const MAX_PAGES = 100;

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const ALLOWED_GROUPS: ReadonlySet<string> = new Set([
  "project_id",
  "line_item",
  "api_key_id",
]);

interface CostsResult {
  amount?: { value?: number | string; currency?: string };
  project_id?: string;
  line_item?: string | null;
  api_key_id?: string | null;
  user_id?: string | null;
  user_email?: string | null;
  organization_id?: string | null;
  project_name?: string | null;
  quantity?: number | null;
}

interface CostsBucket {
  start_time?: number;
  end_time?: number;
  results?: CostsResult[];
}

interface CostsPage {
  data?: CostsBucket[];
  has_more?: boolean;
  next_page?: string | null;
}

export class OpenAiSource implements SourceModule {
  readonly name: Source = SOURCE_NAME;
  readonly requiredEnv: ReadonlyArray<string> = ["OPENAI_ADMIN_KEY"];
  private fetcher: Fetcher;

  constructor(fetcher?: Fetcher) {
    this.fetcher = fetcher ?? fetch;
  }

  isAvailable(): boolean {
    return Boolean(process.env.OPENAI_ADMIN_KEY);
  }

  private headers(): HeadersInit {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${process.env.OPENAI_ADMIN_KEY ?? ""}`,
      Accept: "application/json",
    };
    if (process.env.OPENAI_ORG_ID) {
      headers["OpenAI-Organization"] = process.env.OPENAI_ORG_ID;
    }
    return headers;
  }

  async getCostLines(
    start: Date,
    end: Date,
    groupBy?: string,
  ): Promise<CostLine[]> {
    if (!this.isAvailable()) return [];
    const baseParams = new URLSearchParams({
      start_time: String(Math.floor(start.getTime() / 1000)),
      end_time: String(Math.floor(end.getTime() / 1000)),
      bucket_width: "1d",
      limit: String(PAGE_LIMIT),
    });
    if (groupBy && ALLOWED_GROUPS.has(groupBy)) {
      baseParams.append("group_by[]", groupBy);
    }

    const lines: CostLine[] = [];
    let pageToken: string | null = null;
    let pagesFetched = 0;
    for (;;) {
      const params = new URLSearchParams(baseParams);
      if (pageToken) params.set("page", pageToken);
      const response = await this.fetcher(`${BASE_URL}?${params.toString()}`, {
        headers: this.headers(),
      });
      if (!response.ok) {
        throw sourceHttpError(
          "OpenAI costs",
          response.status,
          "OPENAI_ADMIN_KEY",
          await response.text().catch(() => ""),
        );
      }
      const page = (await response.json()) as CostsPage;
      pagesFetched += 1;
      for (const bucket of page.data ?? []) {
        const ps = bucket.start_time
          ? new Date(bucket.start_time * 1000).toISOString()
          : start.toISOString();
        const pe = bucket.end_time
          ? new Date(bucket.end_time * 1000).toISOString()
          : end.toISOString();
        for (const result of bucket.results ?? []) {
          const value = parseAmountValue(result.amount?.value);
          if (value === null) continue;
          if (
            result.amount?.currency &&
            result.amount.currency.toLowerCase() !== "usd"
          ) {
            continue;
          }
          // Strict per-axis read when groupBy is set — a row whose requested
          // field is null gets group_by_value=undefined, NOT a fallback to a
          // different axis. The fallback was masking null-line_item rows as
          // their project_id, which silently mis-attributed them.
          let groupValue: string | undefined;
          if (groupBy === "project_id") {
            groupValue = result.project_id ?? undefined;
          } else if (groupBy === "line_item") {
            groupValue = result.line_item ?? undefined;
          } else if (groupBy === "api_key_id") {
            groupValue = result.api_key_id ?? undefined;
          }
          lines.push({
            source: SOURCE_NAME,
            period_start: ps,
            period_end: pe,
            amount_usd: roundCurrency(value),
            group_by_field: groupBy,
            group_by_value: groupValue,
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
          `OpenAI costs: pagination safety cap exhausted ` +
            `(${MAX_PAGES} pages) with more pages remaining — ` +
            `totals would be truncated; narrow the requested window`,
        );
      }
      pageToken = page.next_page;
    }
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
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({
      start_time: String(Math.floor(start.getTime() / 1000)),
      end_time: String(Math.floor(end.getTime() / 1000)),
      bucket_width: "1d",
      limit: "1",
    });
    try {
      const response = await this.fetcher(`${BASE_URL}?${params.toString()}`, {
        headers: this.headers(),
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

function parseAmountValue(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
