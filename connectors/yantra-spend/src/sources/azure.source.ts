/**
 * Azure Cost Management source. Uses @azure/arm-costmanagement against
 * subscription scopes. The SDK's `query.usage` and `forecast.usage` methods
 * expect a structured QueryDefinition / ForecastDefinition.
 *
 * Setup commands: docs/iam/azure-sp-setup.md.
 *
 * Multi-subscription: AZURE_SUBSCRIPTION_IDS is comma-separated; we fan out
 * across subscriptions in parallel and concatenate results.
 */

import {
  ClientSecretCredential,
  TokenCredential,
} from "@azure/identity";
import { CostManagementClient } from "@azure/arm-costmanagement";
import {
  Anomaly,
  CostLine,
  Source,
} from "../types/cost-line.js";
import { roundCurrency } from "../fx/fx.js";
import { sourceHttpError } from "../helpers/source-http-error.js";
import { ProbeResult, SourceModule } from "./source-module.js";

const SOURCE_NAME: Source = "azure";

/**
 * Safety cap on Query API pages followed per subscription per call. Azure
 * pages at roughly 1,000 rows, so this allows about 100k rows: far more than
 * a daily, single-dimension query over any window the tools accept. Hitting
 * it throws (as the Anthropic/OpenAI/Cursor sources do) rather than
 * returning a silently truncated total.
 */
const MAX_PAGES = 100;

/** Azure Resource Manager origin. nextLink is only followed to this origin. */
const ARM_ORIGIN = "https://management.azure.com";
const ARM_TOKEN_SCOPE = `${ARM_ORIGIN}/.default`;

const DAY_MS = 24 * 60 * 60 * 1000;

// Mirrors the SDK's QueryDefinition / ForecastDefinition shapes — kept locally
// (rather than imported) so tests can construct fakes without dragging in the
// full SDK type surface. The SDK's serializer expects Date objects on the
// timePeriod fields, NOT ISO strings; passing strings causes a server-side
// 400 because the wire format is computed from `Date#toISOString` at request
// time.
interface QueryUsageBody {
  type: "ActualCost";
  timeframe: "Custom";
  timePeriod: { from: Date; to: Date };
  dataset: {
    granularity: "Daily" | "Monthly" | "None";
    aggregation: { totalCost: { name: string; function: "Sum" } };
    grouping?: Array<{ type: "Dimension"; name: string }>;
  };
}

interface ForecastUsageBody {
  type: "ActualCost";
  timeframe: "Custom";
  timePeriod: { from: Date; to: Date };
  dataset: {
    granularity: "Daily" | "Monthly" | "None";
    aggregation: { totalCost: { name: string; function: "Sum" } };
  };
  includeActualCost?: boolean;
  includeFreshPartialCost?: boolean;
}

interface CostColumn {
  name?: string;
  type?: string;
}

/**
 * One page of a Query or Forecast result in the shape the SDK returns. The
 * SDK's deserializer hoists the wire format's `properties` envelope onto the
 * top level, so `nextLink`, `columns` and `rows` sit directly on the result.
 * `usage()` resolves to `undefined` when Azure answers HTTP 204 (no content).
 */
export interface CostResultPage {
  nextLink?: string | null;
  columns?: CostColumn[];
  rows?: unknown[][];
}

interface CostManagementLike {
  query: {
    usage(
      scope: string,
      body: QueryUsageBody,
    ): Promise<CostResultPage | undefined>;
  };
  forecast: {
    usage(
      scope: string,
      body: ForecastUsageBody,
    ): Promise<CostResultPage | undefined>;
  };
  /**
   * Fetch the page a Query result's `nextLink` points to. The SDK exposes no
   * paging helper for `query.usage`, so the default client resends the query
   * body to the nextLink with a token from the same credential.
   */
  queryNextPage?(
    nextLink: string,
    body: QueryUsageBody,
  ): Promise<CostResultPage | undefined>;
}

const GROUP_BY_DIMENSIONS: Record<string, string> = {
  service: "ServiceName",
  resource_group: "ResourceGroupName",
  resource: "ResourceId",
  meter: "Meter",
  subscription: "SubscriptionId",
};

export class AzureSource implements SourceModule {
  readonly name: Source = SOURCE_NAME;
  readonly requiredEnv: ReadonlyArray<string> = [
    "AZURE_TENANT_ID",
    "AZURE_CLIENT_ID",
    "AZURE_CLIENT_SECRET",
    "AZURE_SUBSCRIPTION_IDS",
  ];
  private clientFactory: (subscriptionId: string) => CostManagementLike;

  constructor(
    clientFactory?: (subscriptionId: string) => CostManagementLike,
  ) {
    this.clientFactory =
      clientFactory ??
      // The credential is tenant-scoped, not subscription-scoped — the same
      // CostManagementClient handles all subscriptions in the tenant — but the
      // factory keeps the per-subscription signature so tests can stub each.
      (() => {
        const credential = makeCredential();
        const client = new CostManagementClient(credential);
        return {
          query: client.query,
          forecast: client.forecast,
          queryNextPage: (nextLink, body) =>
            fetchQueryNextPage(credential, nextLink, body),
        } as CostManagementLike;
      });
  }

  isAvailable(): boolean {
    return (
      Boolean(process.env.AZURE_TENANT_ID) &&
      Boolean(process.env.AZURE_CLIENT_ID) &&
      Boolean(process.env.AZURE_CLIENT_SECRET) &&
      this.subscriptionIds().length > 0
    );
  }

  private subscriptionIds(): string[] {
    const raw = process.env.AZURE_SUBSCRIPTION_IDS ?? "";
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async getCostLines(
    start: Date,
    end: Date,
    groupBy?: string,
  ): Promise<CostLine[]> {
    if (!this.isAvailable()) return [];
    // [start, end) is empty: nothing to ask Azure for (its inclusive `to`
    // would otherwise return the `from` day).
    if (end.getTime() <= start.getTime()) return [];
    const subs = this.subscriptionIds();
    const grouping = groupBy ? GROUP_BY_DIMENSIONS[groupBy] : undefined;
    const body: QueryUsageBody = {
      type: "ActualCost",
      timeframe: "Custom",
      timePeriod: { from: start, to: end },
      dataset: {
        granularity: "Daily",
        aggregation: {
          totalCost: { name: "PreTaxCost", function: "Sum" },
        },
        ...(grouping
          ? { grouping: [{ type: "Dimension", name: grouping }] }
          : {}),
      },
    };
    const queries = subs.map(async (subscriptionId) => {
      const client = this.clientFactory(subscriptionId);
      const scope = `/subscriptions/${subscriptionId}`;
      const pages = await fetchAllQueryPages(client, scope, body);
      const lines: CostLine[] = [];
      let droppedNonUsd = 0;
      let firstNonUsdCurrency: string | null = null;
      let columns: CostColumn[] = [];
      for (const page of pages) {
        // Later pages normally repeat the columns; keep the previous page's
        // columns if one does not.
        if (page.columns && page.columns.length > 0) columns = page.columns;
        const parsed = parseCostRows(columns, page.rows ?? [], {
          costColumn: body.dataset.aggregation.totalCost.name,
          groupColumn: grouping,
          end,
        });
        droppedNonUsd += parsed.droppedNonUsd;
        firstNonUsdCurrency ??= parsed.firstNonUsdCurrency;
        for (const row of parsed.rows) {
          lines.push({
            source: SOURCE_NAME,
            period_start: row.day.toISOString(),
            period_end: new Date(row.day.getTime() + DAY_MS).toISOString(),
            amount_usd: roundCurrency(row.cost),
            group_by_field: groupBy,
            group_by_value: row.groupValue,
            raw: { row: row.raw, columns },
          });
        }
      }
      if (lines.length === 0 && droppedNonUsd > 0) {
        throw nonUsdError(firstNonUsdCurrency, droppedNonUsd);
      }
      return lines;
    });
    const groups = await Promise.all(queries);
    return groups.flat();
  }

  async getAnomalies(_windowDays: number): Promise<Anomaly[]> {
    // Azure surfaces anomalies via Cost Management Insights, a separate API
    // surface this connector does not call: anomalies are not supported for
    // Azure.
    void _windowDays;
    return [];
  }

  async getForecastToMonthEnd(): Promise<CostLine | null> {
    if (!this.isAvailable()) return null;
    const today = new Date();
    // Pin period_start to UTC midnight of today so the response is
    // deterministic regardless of wall-clock at request time.
    const periodStart = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate(),
      ),
    );
    const monthEnd = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1),
    );
    const body: ForecastUsageBody = {
      type: "ActualCost",
      timeframe: "Custom",
      timePeriod: { from: periodStart, to: monthEnd },
      dataset: {
        granularity: "Daily",
        aggregation: {
          totalCost: { name: "PreTaxCost", function: "Sum" },
        },
      },
      includeActualCost: false,
      includeFreshPartialCost: false,
    };
    let total = 0;
    const failures: string[] = [];
    for (const subscriptionId of this.subscriptionIds()) {
      const client = this.clientFactory(subscriptionId);
      const scope = `/subscriptions/${subscriptionId}`;
      try {
        // undefined = HTTP 204: no forecast rows for this subscription.
        const page = await client.forecast.usage(scope, body);
        if (page?.nextLink) {
          // A daily forecast to month end is at most 31 rows, so a second
          // page is unexpected. Fail rather than under-report. Recorded
          // directly as a failure (not thrown) so isForecastUnsupportedError
          // can never classify it as a tier-unsupported skip.
          failures.push(
            `subscription ${subscriptionId}: forecast returned a nextLink; ` +
              `refusing to under-report a paged forecast`,
          );
          continue;
        }
        const parsed = parseCostRows(page?.columns ?? [], page?.rows ?? [], {
          costColumn: body.dataset.aggregation.totalCost.name,
          end: monthEnd,
        });
        if (parsed.rows.length === 0 && parsed.droppedNonUsd > 0) {
          throw nonUsdError(parsed.firstNonUsdCurrency, parsed.droppedNonUsd);
        }
        for (const row of parsed.rows) total += row.cost;
      } catch (err) {
        // Forecast is unsupported on some subscription tiers (offer types);
        // that case is expected degradation and skips silently. Anything
        // else (auth, throttling, 5xx) must NOT be swallowed — collect it
        // and throw below so the forecast handler turns it into a per-source
        // warning (the same propagation route AWS forecast errors take),
        // instead of silently under-reporting the forecast.
        if (isForecastUnsupportedError(err)) continue;
        failures.push(
          `subscription ${subscriptionId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    if (failures.length > 0) {
      throw new Error(`Azure forecast failed — ${failures.join("; ")}`);
    }
    if (total === 0) return null;
    return {
      source: SOURCE_NAME,
      period_start: periodStart.toISOString(),
      period_end: monthEnd.toISOString(),
      amount_usd: roundCurrency(total),
      group_by_field: "forecast",
      group_by_value: "month_end",
      // includeActualCost=false and timePeriod from=today: this is the
      // remainder only — the opposite basis to AWS's full-month forecast.
      forecast_basis:
        "remaining month: today through month end, excluding month-to-date " +
        "actuals",
      raw: { sum_across_subscriptions: total },
    };
  }

  async probe(): Promise<ProbeResult> {
    if (!this.isAvailable()) return { reachable: false, error: "no credentials" };
    const subs = this.subscriptionIds();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const yesterday = new Date(today.getTime() - DAY_MS);
    const body: QueryUsageBody = {
      type: "ActualCost",
      timeframe: "Custom",
      timePeriod: { from: yesterday, to: today },
      dataset: {
        granularity: "Daily",
        aggregation: {
          totalCost: { name: "PreTaxCost", function: "Sum" },
        },
      },
    };
    try {
      // Probe a single subscription — first one is enough to confirm auth.
      const client = this.clientFactory(subs[0]);
      const scope = `/subscriptions/${subs[0]}`;
      await client.query.usage(scope, body);
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
 * True when a forecast.usage rejection means "this subscription tier/offer
 * doesn't support forecasting" — the expected-degradation case the
 * per-subscription loop skips silently. Azure signals it as a 404 on the
 * forecast scope, or as a 4xx whose message names the unsupported offer
 * type ("... doesn't have valid WebDirect/AIRS offer type ...",
 * "Cost management data is not supported for subscription ...").
 * Everything else (401/403 auth, 429 throttle, 5xx) is a real error.
 */
function isForecastUnsupportedError(err: unknown): boolean {
  const e = err as { statusCode?: number; message?: string } | null;
  const message = (e?.message ?? String(err)).toLowerCase();
  if (e?.statusCode === 404) return true;
  return (
    message.includes("not supported") || message.includes("offer type")
  );
}

function makeCredential(): TokenCredential {
  return new ClientSecretCredential(
    process.env.AZURE_TENANT_ID as string,
    process.env.AZURE_CLIENT_ID as string,
    process.env.AZURE_CLIENT_SECRET as string,
  );
}

// Azure's Query and Forecast APIs treat `timePeriod.to` as inclusive: a `to`
// of midnight on day N also returns day N. Every caller here works in
// half-open [start, end), so parseCostRows drops rows dated on or after `end`.
// `to` itself is sent as the midnight boundary, the value this source has
// always sent: a sub-day `to` (end - 1 ms) has not been verified against live
// Azure, and Daily granularity makes the row filter sufficient on its own.
/**
 * Read every page of a Query API result, following `nextLink` up to
 * MAX_PAGES. A 204 (undefined) page contributes no rows.
 */
async function fetchAllQueryPages(
  client: CostManagementLike,
  scope: string,
  body: QueryUsageBody,
): Promise<CostResultPage[]> {
  const pages: CostResultPage[] = [];
  let page = await client.query.usage(scope, body);
  for (let fetched = 1; ; fetched++) {
    if (page) pages.push(page);
    const nextLink = page?.nextLink;
    if (!nextLink) return pages;
    if (fetched >= MAX_PAGES) {
      throw new Error(
        `Azure query (${scope}): pagination safety cap exhausted ` +
          `(${MAX_PAGES} pages) with more pages remaining — ` +
          `totals would be truncated; narrow the requested window`,
      );
    }
    if (!client.queryNextPage) {
      throw new Error(
        `Azure query (${scope}) returned a nextLink but this client cannot ` +
          `follow it — totals would be truncated`,
      );
    }
    page = await client.queryNextPage(nextLink, body);
  }
}

/**
 * Fetch the page a Query API `nextLink` points to: POST the same query body
 * to the nextLink with a bearer token from the source's credential, then
 * flatten the wire `properties` envelope into the SDK's result shape.
 *
 * The token is only ever sent to the Azure Resource Manager origin; any
 * other nextLink is refused.
 */
export async function fetchQueryNextPage(
  credential: TokenCredential,
  nextLink: string,
  body: QueryUsageBody,
  fetchImpl: typeof fetch = fetch,
): Promise<CostResultPage | undefined> {
  let url: URL;
  try {
    url = new URL(nextLink);
  } catch {
    throw new Error("Azure query: nextLink is not a valid URL");
  }
  if (url.origin !== ARM_ORIGIN) {
    throw new Error(
      `Azure query: refusing to follow a nextLink to ${url.origin} ` +
        `(expected ${ARM_ORIGIN})`,
    );
  }
  const token = await credential.getToken(ARM_TOKEN_SCOPE);
  if (!token?.token) {
    throw new Error("Azure query: the credential returned no access token");
  }
  const response = await fetchImpl(url.toString(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token.token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    // Dates serialise through Date#toISOString, as the SDK's serializer does.
    body: JSON.stringify(body),
    // The bearer token must only ever go to the validated nextLink origin.
    redirect: "error",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw sourceHttpError(
      "Azure Cost Management",
      response.status,
      "AZURE_CLIENT_ID / AZURE_CLIENT_SECRET",
      text,
    );
  }
  const text = await response.text();
  if (response.status === 204 || text.trim() === "") return undefined;
  let wire: { properties?: CostResultPage } | null;
  try {
    wire = JSON.parse(text) as { properties?: CostResultPage } | null;
  } catch {
    throw new Error("Azure query: a nextLink page was not valid JSON");
  }
  const props = wire?.properties;
  // Never treat an unrecognised page as "no more rows": that would truncate.
  if (!props) {
    throw new Error("Azure query: a nextLink page had no properties envelope");
  }
  return { nextLink: props.nextLink, columns: props.columns, rows: props.rows };
}

interface ParsedCostRow {
  day: Date;
  cost: number;
  groupValue?: string;
  raw: unknown[];
}

interface ParsedCostRows {
  rows: ParsedCostRow[];
  droppedNonUsd: number;
  firstNonUsdCurrency: string | null;
}

function columnIndex(columns: CostColumn[], name: string): number {
  const wanted = name.toLowerCase();
  return columns.findIndex((c) => (c?.name ?? "").toLowerCase() === wanted);
}

/**
 * Shared row parser for Query and Forecast results. Columns are located by
 * name, never by position: the cost column (the aggregation's source column,
 * e.g. PreTaxCost), UsageDate (a YYYYMMDD number) and Currency. Non-USD rows
 * are dropped and counted so callers can refuse a wholly non-USD
 * subscription; rows dated on or after `end` are dropped as the backstop for
 * Azure's inclusive `to`.
 */
function parseCostRows(
  columns: CostColumn[],
  rows: unknown[][],
  opts: { costColumn: string; groupColumn?: string; end: Date },
): ParsedCostRows {
  const result: ParsedCostRows = {
    rows: [],
    droppedNonUsd: 0,
    firstNonUsdCurrency: null,
  };
  if (rows.length === 0) return result;

  const dateIdx = columnIndex(columns, "UsageDate");
  const currencyIdx = columnIndex(columns, "Currency");
  let costIdx = columnIndex(columns, opts.costColumn);
  if (costIdx < 0) {
    // Fall back only when exactly one numeric column besides UsageDate
    // exists; otherwise refuse rather than guess which column is cost.
    const numeric = columns
      .map((c, i) => ({ type: (c?.type ?? "").toLowerCase(), i }))
      .filter((c) => c.type === "number" && c.i !== dateIdx);
    if (numeric.length === 1) costIdx = numeric[0].i;
  }
  const names = columns.map((c) => c?.name ?? "?").join(", ");
  if (costIdx < 0) {
    throw new Error(
      `Azure response has no ${opts.costColumn} cost column (columns: ${names})`,
    );
  }
  if (dateIdx < 0) {
    throw new Error(
      `Azure response has no UsageDate column (columns: ${names})`,
    );
  }
  let groupIdx = -1;
  if (opts.groupColumn) {
    groupIdx = columnIndex(columns, opts.groupColumn);
    if (groupIdx < 0) {
      // Dimension columns are normally named after the dimension; otherwise
      // take the first String column that is not known metadata.
      groupIdx = columns.findIndex(
        (c, i) =>
          (c?.type ?? "").toLowerCase() === "string" &&
          i !== currencyIdx &&
          i !== dateIdx &&
          (c?.name ?? "").toLowerCase() !== "coststatus",
      );
    }
  }

  const endMs = opts.end.getTime();
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const cost = Number(row[costIdx]);
    if (!Number.isFinite(cost)) continue;
    const day = parseUsageDate(row[dateIdx]);
    if (!day) continue;
    if (day.getTime() >= endMs) continue;
    // A response without a Currency column is taken as USD, as before.
    const currency =
      currencyIdx >= 0 ? String(row[currencyIdx] ?? "USD") : "USD";
    if (currency.toUpperCase() !== "USD") {
      result.droppedNonUsd += 1;
      result.firstNonUsdCurrency ??= currency;
      continue;
    }
    const groupRaw = groupIdx >= 0 ? row[groupIdx] : undefined;
    result.rows.push({
      day,
      cost,
      groupValue:
        groupRaw === null || groupRaw === undefined
          ? undefined
          : String(groupRaw),
      raw: row,
    });
  }
  return result;
}

/**
 * A subscription whose rows are all non-USD surfaces as an error instead of
 * silently reporting zero spend. Mixed-currency subscriptions are uncommon;
 * their USD rows are kept and the others dropped (converting non-USD rows is
 * not supported).
 */
function nonUsdError(currency: string | null, dropped: number): Error {
  return new Error(
    `Azure subscription returns ${currency} ` +
      `(${dropped} rows dropped); yantra-spend only supports USD-billed ` +
      `Azure subscriptions — set AZURE_SUBSCRIPTION_IDS to only USD subs`,
  );
}

function parseUsageDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw;
  // Azure returns UsageDate as a Number like 20260501.
  if (typeof raw === "number" || (typeof raw === "string" && /^\d{8}$/.test(raw))) {
    const s = String(raw);
    const year = Number(s.slice(0, 4));
    const month = Number(s.slice(4, 6)) - 1;
    const day = Number(s.slice(6, 8));
    const d = new Date(Date.UTC(year, month, day));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === "string") {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
