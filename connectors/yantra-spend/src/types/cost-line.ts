/**
 * Canonical cost-data shapes. USD is ground truth on every CostLine; GBP is
 * only populated when the caller asked for currency=GBP. Each source module
 * emits CostLine; the façade aggregates.
 *
 * Amounts are JSON `number`. Provider precision (typically <= 6 decimal places
 * for cloud-billing detail) is preserved by source modules — they may also
 * include the original string in `raw` for byte-identical reconciliation.
 */

export const SOURCES = [
  "aws",
  "gcp",
  "azure",
  "anthropic",
  "openai",
  "cursor",
] as const;

export type Source = (typeof SOURCES)[number];

export const CURRENCIES = ["USD", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface CostLine {
  source: Source;
  /** Inclusive period start, ISO-8601 with timezone (always UTC). */
  period_start: string;
  /** Exclusive period end, ISO-8601 with timezone (always UTC). */
  period_end: string;
  /** USD amount, number. Always populated. */
  amount_usd: number;
  /** GBP amount, number. Populated iff caller passed currency=GBP. */
  amount_gbp?: number;
  /** Group-by axis name, e.g. "service", "workspace", "project_id". */
  group_by_field?: string;
  /**
   * Group-by axis value, e.g. "AmazonEC2", "wrkspc_…". Explicitly `null`
   * (never a dropped key) on zero-pad lines in grouped responses: null means
   * "padded day — the source returned no data for ANY group that day", which
   * is distinct from a real group that spent $0.
   */
  group_by_value?: string | null;
  /**
   * Forecast entries only. States what the amount covers, because sources
   * disagree: AWS forecasts the FULL current calendar month (month-to-date
   * actuals baked in), Azure forecasts only the remainder from today.
   */
  forecast_basis?: string;
  /** Provider-original blob for byte-identical reconciliation. */
  raw?: Record<string, unknown>;
}

export interface SourceTotal {
  source: Source;
  /**
   * USD amount when the source returned successfully. `null` when the source
   * failed (API threw, non-2xx) — the failure is also recorded in the
   * top-level `warnings` array. Distinguishes "I asked the source and it said
   * zero" from "I asked the source and it errored".
   */
  amount_usd: number | null;
  amount_gbp?: number | null;
  /**
   * Number of PROVIDER-RETURNED CostLine rows; null when the source failed.
   * No zero-padding is applied here — spend_by_source pads missing days with
   * zero-amount lines for the same window, so its total_line_count can exceed
   * this for an identical [start, end): reconcile via total_line_count −
   * zero_pad_line_count == line_count.
   */
  line_count: number | null;
}

export interface SpendSummary {
  period_start: string;
  period_end: string;
  currency: Currency;
  /** Rate used for any GBP conversion in this response. */
  fx_gbp_per_usd?: number;
  /** Sum of every source's amount_usd, excluding any that failed. */
  grand_total_usd: number;
  grand_total_gbp?: number;
  /**
   * Week-over-week (equal-length prior window) percentage delta, computed over
   * the INTERSECTION of sources that returned data in both windows — NOT over
   * grand_total_usd. It is non-null even when `partial` is true. `null` only
   * when that intersection is empty, when the prior intersection sum is <= 0,
   * or when the current intersection sum rounds to zero — see `warnings` for
   * the reason, and for the contributing sources when partial.
   */
  wow_delta_pct: number | null;
  /**
   * `true` when at least one source either has no credentials, was skipped,
   * or returned an error. Failed sources are excluded from `grand_total_usd`.
   */
  partial: boolean;
  /** Per-source skip and error notes. Never throws. */
  warnings: string[];
  /**
   * Per-source totals. Serialized AFTER partial/warnings so skip/error
   * signals lead the array.
   */
  sources: SourceTotal[];
}

export interface TopMover {
  source: Source;
  /** Render-ready label, e.g. "aws: AmazonEC2", "anthropic: claude-sonnet-4-6". */
  label: string;
  delta_usd: number;
  delta_gbp?: number;
  /** % change relative to prior window. `null` when prior was zero (no baseline). */
  pct_change: number | null;
  current_period_usd: number;
  prior_period_usd: number;
}

export interface Anomaly {
  source: Source;
  /** When the provider flagged the anomaly. ISO-8601 UTC. */
  detected_at: string;
  description: string;
  impact_usd?: number;
  raw?: Record<string, unknown>;
}
