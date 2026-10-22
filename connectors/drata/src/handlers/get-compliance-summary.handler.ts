import { getDrataClient } from "../clients/drata-client.js";
import { mapDrataError } from "../helpers/error-mapping.js";
import {
  isMonitorError,
  isMonitorFailing,
  isMonitorPassing,
} from "../helpers/monitor-status.js";
import { fetchEnrichedControls } from "./check-controls.handler.js";
import type { DrataClientResponse } from "../types/drata-client-response.js";

export async function getComplianceSummary(): Promise<
  DrataClientResponse<unknown>
> {
  try {
    const client = getDrataClient();
    // Controls come from the shared V2 enrichment (evidence of any kind,
    // archived excluded) so the summary matches check_control_status and
    // the app's in-scope counts.
    const [
      { controls, archivedCount },
      monitors,
      personnel,
      vendors,
      policies,
      assets,
      devices,
      connections,
    ] = await Promise.all([
      fetchEnrichedControls(),
      client.getMonitors(),
      client.getPersonnel(),
      client.getVendors(),
      client.getPolicies(),
      client.getAssets(),
      client.getDevices(),
      client.getConnections(),
    ]);

    return {
      isError: false,
      result: {
        totalControls: controls.length,
        archivedControlsExcluded: archivedCount,
        readyControls: controls.filter((c) => c.isReady).length,
        monitoredControls: controls.filter((c) => c.isMonitored).length,
        controlsWithEvidence: controls.filter((c) => c.hasEvidence).length,
        controlsWithOwner: controls.filter((c) => c.hasOwner).length,
        totalMonitors: monitors.length,
        passingMonitors: monitors.filter(isMonitorPassing).length,
        // failingMonitors keeps its historical meaning (not passing, not
        // disabled) — but ERROR checks ran without producing a result, so
        // break them out; the app's Failed tab is failing minus errored.
        failingMonitors: monitors.filter(isMonitorFailing).length,
        errorMonitors: monitors.filter(isMonitorError).length,
        // Same established `note` key check_monitors uses for its caveat.
        note:
          "failingMonitors includes errorMonitors (checks that ran but could not evaluate); the Drata app's Failed count is failingMonitors - errorMonitors.",
        totalPersonnel: personnel.length,
        totalVendors: vendors.length,
        totalPolicies: policies.length,
        // Live assets only (removedAt unset) — mirrors list_assets' default
        // total and the Drata app's asset inventory; offboarded assets can be
        // the large majority of the raw V1 list.
        totalAssets: assets.filter(
          (a) => (a as Record<string, unknown>).removedAt == null,
        ).length,
        totalDevices: devices.length,
        totalConnections: connections.length,
        healthyConnections: connections.filter((c) => {
          const state = (c as Record<string, unknown>).state;
          const failedAt = (c as Record<string, unknown>).failedAt;
          return state === "ACTIVE" && !failedAt;
        }).length,
      },
    };
  } catch (err) {
    return mapDrataError(err);
  }
}
