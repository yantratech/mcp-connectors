import type { Monitor } from "../clients/drata-client.js";

// Drata's public API reports monitor results under `checkResultStatus`. Newer
// monitors use PASSED/FAILED; legacy ones still emit READY. Treat both as
// passing so a monitor in either dialect lands in the same bucket.
const PASSING_STATUSES = new Set(["PASSED", "READY"]);

// `checkStatus` values: ENABLED (normal), DISABLED (turned off — see
// `disabledMessage`), TESTING (transient: Drata's daily sweep is
// re-evaluating the monitor). TESTING is NOT disabled; those monitors keep
// their last `checkResultStatus`, so passing/failing count them by that last
// result instead of dropping them (which made summary buckets stop summing
// to totalMonitors mid-sweep).
export function isMonitorDisabled(m: Monitor): boolean {
  return m.checkStatus === "DISABLED";
}

export function isMonitorTesting(m: Monitor): boolean {
  return m.checkStatus === "TESTING";
}

export function isMonitorPassing(m: Monitor): boolean {
  return !isMonitorDisabled(m) && PASSING_STATUSES.has(m.checkResultStatus);
}

export function isMonitorFailing(m: Monitor): boolean {
  return !isMonitorDisabled(m) && !PASSING_STATUSES.has(m.checkResultStatus);
}

// ERROR is a failing sub-state: the check ran but could not evaluate (e.g.
// backup monitors that found no alert configuration). It is included in
// `failing` everywhere; `isMonitorError` isolates just the ERROR ones.
export function isMonitorError(m: Monitor): boolean {
  return !isMonitorDisabled(m) && m.checkResultStatus === "ERROR";
}
