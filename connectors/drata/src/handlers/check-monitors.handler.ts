import { getDrataClient } from "../clients/drata-client.js";
import type { Monitor } from "../clients/drata-client.js";
import { mapDrataError } from "../helpers/error-mapping.js";
import { pickFields } from "../helpers/field-selection.js";
import {
  isMonitorDisabled,
  isMonitorError,
  isMonitorFailing,
  isMonitorPassing,
  isMonitorTesting,
} from "../helpers/monitor-status.js";
import type { DrataClientResponse } from "../types/drata-client-response.js";

const SEMANTICS_NOTE =
  "statusCounts are tenant-wide (passing + failing + disabled = totalMonitors; " +
  "error is a subset of failing; TESTING-state monitors are mid re-evaluation " +
  "and counted by their last result). failureDetails appears only on " +
  "failing/error monitors and is Drata's static description of what the " +
  "failure means, not a live diagnostic — use list_monitoring_test_failures " +
  "for specifics. The static pass-criteria `description` is opt-in via fields[].";

// Both `description` (pass-criteria) and `failedTestDescription` (what a
// failure means) are static Drata templates present on every monitor
// regardless of status. Emitting the failure template on passing monitors
// made LLMs assert failures that were not happening, so it appears only on
// failing/error entries — even when requested via fields[].
function buildEntry(m: Monitor, fields?: string[]): Record<string, unknown> {
  const full: Record<string, unknown> = {
    id: m.id,
    name: m.name,
    status: m.checkResultStatus,
    checkStatus: m.checkStatus,
    priority: m.priority,
    lastCheck: m.lastCheck,
    description: m.description,
  };
  if (isMonitorFailing(m)) {
    full.failureDetails =
      m.monitorInstances?.[0]?.failedTestDescription || null;
  }
  if (isMonitorDisabled(m) && m.disabledMessage) {
    full.disabledMessage = m.disabledMessage;
  }
  if (fields && fields.length > 0) return pickFields(full, fields);
  // Compact default: drop the static template prose, and the checkStatus
  // passthrough when it is the unremarkable ENABLED.
  delete full.description;
  if (m.checkStatus === "ENABLED") delete full.checkStatus;
  return full;
}

export async function checkMonitors(
  filter?: string,
  options?: { fields?: string[]; size?: number; page?: number },
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const monitors = await client.getMonitors();

    const statusCounts = {
      passing: monitors.filter(isMonitorPassing).length,
      failing: monitors.filter(isMonitorFailing).length,
      error: monitors.filter(isMonitorError).length,
      testing: monitors.filter(isMonitorTesting).length,
      disabled: monitors.filter(isMonitorDisabled).length,
    };

    let filtered = monitors;
    switch (filter) {
      case "failing":
        filtered = monitors.filter(isMonitorFailing);
        break;
      case "error":
        // ERROR is a subset of failing; this isolates the ERROR-state monitors.
        filtered = monitors.filter(isMonitorError);
        break;
      case "passing":
        filtered = monitors.filter(isMonitorPassing);
        break;
      case "testing":
        filtered = monitors.filter(isMonitorTesting);
        break;
      case "disabled":
        filtered = monitors.filter(isMonitorDisabled);
        break;
    }

    const limit = options?.size ?? 50;
    const page = options?.page ?? 1;
    const start = (page - 1) * limit;
    const slice = filtered.slice(start, start + limit);

    return {
      isError: false,
      result: {
        filter: filter || "all",
        totalMonitors: monitors.length,
        matched: filtered.length,
        returned: slice.length,
        page,
        limit,
        hasMore: start + limit < filtered.length,
        statusCounts,
        note: SEMANTICS_NOTE,
        monitors: slice.map((m) => buildEntry(m, options?.fields)),
      },
    };
  } catch (err) {
    return mapDrataError(err);
  }
}
