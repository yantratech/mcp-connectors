import { Anomaly, CostLine, Source } from "../types/cost-line.js";

/**
 * Result of a `probe()` — a cheap call to the source's API used by `health`
 * to verify reachability beyond just env-var presence.
 */
export interface ProbeResult {
  reachable: boolean;
  /** Short error string when reachable=false. Masked of credentials. */
  error?: string;
}

/**
 * Provider integration. All amounts are USD-native; the façade handles GBP
 * conversion. Each module reads its own credentials from process.env and
 * silently disables when absent — the façade surfaces a per-tool warning,
 * never a thrown error.
 */
export interface SourceModule {
  readonly name: Source;

  /**
   * Env var name(s) this source reads for credentials/config. Surfaced by
   * `health` when the source is unavailable so an agent can tell the user
   * exactly what to set without reading source code. Empty for GCP, which
   * is not supported and takes no credentials.
   */
  readonly requiredEnv: ReadonlyArray<string>;

  /** True iff credentials/config are present for this source. */
  isAvailable(): boolean;

  /** Cost lines for [start, end). `groupBy` is source-specific. */
  getCostLines(
    start: Date,
    end: Date,
    groupBy?: string,
  ): Promise<CostLine[]>;

  /** Provider-detected anomalies in the trailing window. Empty if unsupported. */
  getAnomalies(windowDays: number): Promise<Anomaly[]>;

  /** Single CostLine forecasting today→month-end. Null if unsupported. */
  getForecastToMonthEnd(): Promise<CostLine | null>;

  /**
   * Cheap reachability probe. Hits the source's API with a minimal call
   * (e.g. yesterday's window) and returns whether the API responded
   * successfully. Resolves rather than rejects — exceptions become
   * `{reachable: false, error}`.
   *
   * GCP, which is not supported, returns
   * `{reachable: false, error: "unsupported"}`.
   */
  probe(): Promise<ProbeResult>;
}
