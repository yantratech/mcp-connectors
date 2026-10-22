/**
 * GCP source — not supported. "gcp" stays in the Source list so callers can
 * name it and get a clean per-source "unsupported" warning instead of an
 * unknown-source error. It is never available, whatever the environment, and
 * returns no data.
 */

import { Anomaly, CostLine, Source } from "../types/cost-line.js";
import { ProbeResult, SourceModule } from "./source-module.js";

const SOURCE_NAME: Source = "gcp";

export class GcpSource implements SourceModule {
  readonly name: Source = SOURCE_NAME;
  // Not supported: no credentials enable it, so there is nothing to set.
  readonly requiredEnv: ReadonlyArray<string> = [];

  isAvailable(): boolean {
    // Always false: GCP is not supported (not a missing-credentials case).
    return false;
  }

  async getCostLines(
    _start: Date,
    _end: Date,
    _groupBy?: string,
  ): Promise<CostLine[]> {
    void _start;
    void _end;
    void _groupBy;
    return [];
  }

  async getAnomalies(_windowDays: number): Promise<Anomaly[]> {
    void _windowDays;
    return [];
  }

  async getForecastToMonthEnd(): Promise<CostLine | null> {
    return null;
  }

  async probe(): Promise<ProbeResult> {
    return { reachable: false, error: "unsupported" };
  }
}
