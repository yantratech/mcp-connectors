/**
 * AWS Cost Explorer source. Cost Explorer is single-region (us-east-1) even
 * for multi-region workloads. Billed per request — see
 * docs/iam/aws-readonly-policy.json for the minimum policy.
 */

import {
  CostExplorerClient,
  GetAnomaliesCommand,
  GetCostAndUsageCommand,
  GetCostForecastCommand,
} from "@aws-sdk/client-cost-explorer";
import {
  Anomaly,
  CostLine,
  Source,
} from "../types/cost-line.js";
import { roundCurrency } from "../fx/fx.js";
import { utcDateOnly } from "../helpers/parse-iso-utc.js";
import { ProbeResult, SourceModule } from "./source-module.js";

const SOURCE_NAME: Source = "aws";

interface CostExplorerLike {
  send(command: GetCostAndUsageCommand): Promise<unknown>;
  send(command: GetCostForecastCommand): Promise<unknown>;
  send(command: GetAnomaliesCommand): Promise<unknown>;
}

const GROUP_BY_MAP: Record<
  string,
  { Type: "DIMENSION" | "TAG" | "COST_CATEGORY"; Key: string }
> = {
  service: { Type: "DIMENSION", Key: "SERVICE" },
  region: { Type: "DIMENSION", Key: "REGION" },
  account: { Type: "DIMENSION", Key: "LINKED_ACCOUNT" },
  usage_type: { Type: "DIMENSION", Key: "USAGE_TYPE" },
  "tag:project": { Type: "TAG", Key: "project" },
  "tag:env": { Type: "TAG", Key: "env" },
  "tag:owner": { Type: "TAG", Key: "owner" },
};

export class AwsSource implements SourceModule {
  readonly name: Source = SOURCE_NAME;
  readonly requiredEnv: ReadonlyArray<string> = [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ];
  private clientFactory: () => CostExplorerLike;
  private cachedClient: CostExplorerLike | null = null;

  constructor(clientFactory?: () => CostExplorerLike) {
    this.clientFactory =
      clientFactory ??
      (() =>
        new CostExplorerClient({
          // Cost Explorer is only available in us-east-1; allow override for moto-style fakes.
          region: process.env.AWS_REGION || "us-east-1",
        }));
  }

  /**
   * Lazily build the CostExplorerClient and reuse it across method calls.
   * AWS SDK v3 client construction resolves credentials and wires middleware
   * — non-trivial cost; without caching, top_movers spawned two clients per
   * AWS source per call (current + prior windows).
   */
  private getClient(): CostExplorerLike {
    if (this.cachedClient === null) {
      this.cachedClient = this.clientFactory();
    }
    return this.cachedClient;
  }

  isAvailable(): boolean {
    return Boolean(
      process.env.AWS_PROFILE ||
        (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
    );
  }

  async getCostLines(
    start: Date,
    end: Date,
    groupBy?: string,
  ): Promise<CostLine[]> {
    if (!this.isAvailable()) return [];
    const client = this.getClient();
    const groupSpec = groupBy ? GROUP_BY_MAP[groupBy] : undefined;

    const lines: CostLine[] = [];
    // Cost Explorer paginates ResultsByTime with NextPageToken (long windows
    // and/or high-cardinality group-bys overflow a single page). Reading only
    // the first page silently under-reported long windows — loop until AWS
    // stops returning a token.
    let nextPageToken: string | undefined;
    do {
      const command = new GetCostAndUsageCommand({
        TimePeriod: { Start: utcDateOnly(start), End: utcDateOnly(end) },
        Granularity: "DAILY",
        Metrics: ["UnblendedCost"],
        ...(groupSpec ? { GroupBy: [groupSpec] } : {}),
        ...(nextPageToken ? { NextPageToken: nextPageToken } : {}),
      });
      const response = (await client.send(command)) as {
        ResultsByTime?: Array<{
          TimePeriod?: { Start?: string; End?: string };
          Groups?: Array<{
            Keys?: string[];
            Metrics?: { UnblendedCost?: { Amount?: string } };
          }>;
          Total?: { UnblendedCost?: { Amount?: string } };
        }>;
        NextPageToken?: string;
      };

      for (const bucket of response.ResultsByTime ?? []) {
        // AWS returns date-only ("2026-05-01") on this endpoint; normalise to
        // full ISO-8601 with milliseconds + Z so timestamps line up across
        // sources (e.g. "2026-05-01T00:00:00.000Z" not "2026-05-01T00:00:00Z").
        const ps = bucket.TimePeriod?.Start
          ? toIsoUtcDay(bucket.TimePeriod.Start, start)
          : start.toISOString();
        const pe = bucket.TimePeriod?.End
          ? toIsoUtcDay(bucket.TimePeriod.End, end)
          : end.toISOString();
        const groups = bucket.Groups ?? [];
        if (groups.length > 0) {
          for (const grp of groups) {
            const amountStr = grp.Metrics?.UnblendedCost?.Amount ?? "0";
            lines.push({
              source: SOURCE_NAME,
              period_start: ps,
              period_end: pe,
              amount_usd: roundCurrency(Number(amountStr)),
              group_by_field: groupBy,
              group_by_value: grp.Keys?.[0],
              raw: grp as unknown as Record<string, unknown>,
            });
          }
        } else {
          const amountStr = bucket.Total?.UnblendedCost?.Amount ?? "0";
          lines.push({
            source: SOURCE_NAME,
            period_start: ps,
            period_end: pe,
            amount_usd: roundCurrency(Number(amountStr)),
            group_by_field: groupBy,
            raw: bucket as unknown as Record<string, unknown>,
          });
        }
      }
      nextPageToken = response.NextPageToken;
    } while (nextPageToken);
    return lines;
  }

  async getAnomalies(windowDays: number): Promise<Anomaly[]> {
    if (!this.isAvailable()) return [];
    const client = this.getClient();
    const end = new Date();
    const start = new Date(end.getTime() - windowDays * 24 * 60 * 60 * 1000);
    const anomalies: Anomaly[] = [];
    // GetAnomalies paginates with the same NextPageToken contract as
    // GetCostAndUsage — follow the token so busy accounts don't silently
    // lose anomalies past the first page.
    let nextPageToken: string | undefined;
    do {
      const command = new GetAnomaliesCommand({
        DateInterval: {
          StartDate: utcDateOnly(start),
          EndDate: utcDateOnly(end),
        },
        ...(nextPageToken ? { NextPageToken: nextPageToken } : {}),
      });
      const response = (await client.send(command)) as {
        Anomalies?: Array<{
          AnomalyStartDate?: string;
          AnomalyEndDate?: string;
          DimensionValue?: string;
          Impact?: { TotalImpact?: number };
          RootCauses?: Array<{
            Service?: string;
            UsageType?: string;
            Region?: string;
            LinkedAccount?: string;
            LinkedAccountName?: string;
          }>;
        }>;
        NextPageToken?: string;
      };
      for (const a of response.Anomalies ?? []) {
        const detected = a.AnomalyStartDate
          ? safeIso(a.AnomalyStartDate)
          : new Date().toISOString();
        anomalies.push({
          source: SOURCE_NAME,
          detected_at: detected,
          description: buildAnomalyDescription(a),
          impact_usd:
            typeof a.Impact?.TotalImpact === "number"
              ? roundCurrency(a.Impact.TotalImpact)
              : undefined,
          raw: a as unknown as Record<string, unknown>,
        });
      }
      nextPageToken = response.NextPageToken;
    } while (nextPageToken);
    return anomalies;
  }

  async getForecastToMonthEnd(): Promise<CostLine | null> {
    if (!this.isAvailable()) return null;
    const client = this.getClient();
    const today = new Date();
    const monthEnd = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1),
    );
    const command = new GetCostForecastCommand({
      TimePeriod: {
        Start: utcDateOnly(today),
        End: utcDateOnly(monthEnd),
      },
      Metric: "UNBLENDED_COST",
      Granularity: "MONTHLY",
    });
    // Errors (auth, throttling, missing permission, "insufficient history"
    // from a freshly-enabled CE) propagate to the forecast handler, which
    // turns them into per-source warnings rather than silently omitting the
    // source. The previous catch-and-return-null hid auth failures behind
    // "this source doesn't forecast".
    const response = (await client.send(command)) as {
      Total?: { Amount?: string };
      ForecastResultsByTime?: Array<{
        TimePeriod?: { Start?: string; End?: string };
      }>;
    };
    const amount = Number(response.Total?.Amount ?? "0");
    // Prefer the response's TimePeriod (UTC midnight) over `today`
    // (which would be the current wall clock and varies request to request).
    const reportedStart =
      response.ForecastResultsByTime?.[0]?.TimePeriod?.Start;
    const reportedEnd = response.ForecastResultsByTime?.[0]?.TimePeriod?.End;
    const periodStart = reportedStart
      ? toIsoUtcDay(reportedStart, today)
      : new Date(
          Date.UTC(
            today.getUTCFullYear(),
            today.getUTCMonth(),
            today.getUTCDate(),
          ),
        ).toISOString();
    const periodEnd = reportedEnd
      ? toIsoUtcDay(reportedEnd, monthEnd)
      : monthEnd.toISOString();
    return {
      source: SOURCE_NAME,
      period_start: periodStart,
      period_end: periodEnd,
      amount_usd: roundCurrency(amount),
      group_by_field: "forecast",
      group_by_value: "month_end",
      // Although the request sends Start=today, Cost Explorer aligns the
      // MONTHLY-granularity bucket to the calendar month and its Total
      // includes month-to-date actuals (verified live: Total equalled MTD
      // actuals plus a couple of days of run-rate). Label it so the
      // amount is not misread as remaining-from-today spend.
      forecast_basis:
        "full current calendar month: month-to-date actuals plus projected " +
        "remainder — NOT remaining spend from today",
      raw: response as unknown as Record<string, unknown>,
    };
  }

  async probe(): Promise<ProbeResult> {
    if (!this.isAvailable()) {
      return { reachable: false, error: "no credentials" };
    }
    const client = this.getClient();
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    try {
      // Cheapest CE call we can make: 1-day window, no grouping, single metric.
      const command = new GetCostAndUsageCommand({
        TimePeriod: { Start: utcDateOnly(start), End: utcDateOnly(end) },
        Granularity: "DAILY",
        Metrics: ["UnblendedCost"],
      });
      await client.send(command);
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
 * Coerce a date-only or ISO string to canonical ISO-8601 with milliseconds.
 * Falls back to the supplied default Date if parsing fails.
 */
function toIsoUtcDay(raw: string, fallback: Date): string {
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  const dateOnly = new Date(`${raw}T00:00:00.000Z`);
  if (!Number.isNaN(dateOnly.getTime())) return dateOnly.toISOString();
  return fallback.toISOString();
}

/**
 * Build the canonical anomaly description. Format:
 *   "<DimensionValue> anomaly — <UsageType> in <Region> (account: <LinkedAccountName>)"
 * when those fields exist on any RootCause; falls back to
 *   "<DimensionValue> anomaly"
 * otherwise. DimensionValue is the top-level service-or-account dimension
 * AWS attributes the anomaly to; the RootCauses array enriches with usage
 * type, region, and linked account name.
 */
function buildAnomalyDescription(a: {
  DimensionValue?: string;
  RootCauses?: Array<{
    UsageType?: string;
    Region?: string;
    LinkedAccountName?: string;
  }>;
}): string {
  const dim = a.DimensionValue ?? "AWS cost";
  const causes = a.RootCauses ?? [];
  const usageType = causes.find((c) => c.UsageType)?.UsageType;
  const region = causes.find((c) => c.Region)?.Region;
  const account = causes.find((c) => c.LinkedAccountName)?.LinkedAccountName;
  const enrichments: string[] = [];
  if (usageType) enrichments.push(usageType);
  let location = "";
  if (region) location = ` in ${region}`;
  let acct = "";
  if (account) acct = ` (account: ${account})`;
  if (enrichments.length === 0 && !region && !account) {
    return `${dim} anomaly`;
  }
  return `${dim} anomaly — ${enrichments.join(", ")}${location}${acct}`.trim();
}

/**
 * Defensive ISO normaliser. AWS sometimes returns YYYY-MM-DD and sometimes
 * YYYY-MM-DDTHH:MM:SSZ on the same field across different endpoints. Try the
 * raw form first; if that's invalid, fall back to a date-only interpretation.
 * Always emits the canonical milliseconds-Z form.
 */
function safeIso(raw: string): string {
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  const dateOnly = new Date(`${raw}T00:00:00.000Z`);
  if (!Number.isNaN(dateOnly.getTime())) return dateOnly.toISOString();
  return new Date().toISOString();
}
