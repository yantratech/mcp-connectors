import { getDrataClient } from "../clients/drata-client.js";
import { mapDrataError } from "../helpers/error-mapping.js";
import {
  isMonitorError,
  isMonitorFailing,
  isMonitorPassing,
} from "../helpers/monitor-status.js";
import { normalizeTag, type EnrichedControl } from "../helpers/v2-control-evidence.js";
import { fetchEnrichedControls } from "./check-controls.handler.js";
import type { DrataClientResponse } from "../types/drata-client-response.js";
import type { Monitor } from "../clients/drata-client.js";

interface GapAnalysisResult {
  overview: {
    totalControls: number;
    readyControls: number;
    notReadyControls: number;
    readinessPercentage: number;
    totalMonitors: number;
    failingMonitors: number;
    passingMonitors: number;
    totalPersonnel: number;
    totalVendors: number;
    totalPolicies: number;
    totalConnections: number;
  };
  semanticsNote: string;
  gaps: {
    critical: string[];
    high: string[];
    medium: string[];
    low: string[];
  };
  nextActions: string[];
}

/**
 * Failing monitors land in the severity bucket matching the monitor's OWN
 * Drata priority, not a blanket "critical".
 * Observed priorities: HIGH / NORMAL / LOW; CRITICAL is in Drata's enum.
 */
function severityForPriority(
  priority: string | undefined,
): "critical" | "high" | "medium" | "low" {
  switch ((priority ?? "").toUpperCase()) {
    case "CRITICAL":
      return "critical";
    case "HIGH":
      return "high";
    case "LOW":
      return "low";
    default:
      return "medium";
  }
}

export async function runGapAnalysis(
  frameworkFilter?: string,
): Promise<DrataClientResponse<GapAnalysisResult>> {
  try {
    const client = getDrataClient();
    // Controls come from the shared V2 enrichment (evidence of any kind,
    // archived excluded) so the gap analysis reports the same numbers as
    // check_control_status and the app.
    const [{ controls }, monitors, personnel, vendors, policies, connections] =
      await Promise.all([
        fetchEnrichedControls(),
        client.getMonitors(),
        client.getPersonnel(),
        client.getVendors(),
        client.getPolicies(),
        client.getConnections(),
      ]);

    const wanted = frameworkFilter ? normalizeTag(frameworkFilter) : null;
    const filtered = wanted
      ? controls.filter((c) =>
          c.frameworkTags.some((tag) => normalizeTag(tag) === wanted),
        )
      : controls;

    if (frameworkFilter && filtered.length === 0) {
      const availableTags = [
        ...new Set(controls.flatMap((c) => c.frameworkTags)),
      ];
      return {
        isError: true,
        error: `No controls found for framework "${frameworkFilter}". Available frameworks: ${availableTags.join(", ")}`,
      };
    }

    const critical: string[] = [];
    const high: string[] = [];
    const medium: string[] = [];
    const low: string[] = [];
    const buckets = { critical, high, medium, low };

    const failingMonitors = monitors.filter(isMonitorFailing);
    for (const m of failingMonitors) {
      // ERROR = the check could not evaluate (connection/config issue). Its
      // failedTestDescription is a static what-failure-would-mean template,
      // not an observed finding — never assert it for errored checks.
      const line = isMonitorError(m)
        ? `MONITOR ERROR: ${m.name} (${m.priority}) — check could not evaluate (connection/config issue); result unknown`
        : `FAILING MONITOR: ${m.name} (${m.priority}) — ${m.monitorInstances?.[0]?.failedTestDescription || "No description"}`;
      buckets[severityForPriority(m.priority)].push(line);
    }

    // No evidence = high
    const noEvidence = filtered.filter((c) => !c.hasEvidence);
    if (noEvidence.length > 0) {
      high.push(
        `${noEvidence.length} controls have NO evidence. Top 10: ${noEvidence
          .slice(0, 10)
          .map((c) => `${c.code} (${c.name})`)
          .join(", ")}`,
      );
    }

    // No owners = medium
    const noOwner = filtered.filter((c) => !c.hasOwner);
    if (noOwner.length > 0) {
      medium.push(
        `${noOwner.length} controls have NO owner. This blocks audit readiness.`,
      );
    }

    // Not monitored = medium
    const notMonitored = filtered.filter((c) => !c.isMonitored);
    if (notMonitored.length > 0) {
      medium.push(
        `${notMonitored.length} controls are NOT monitored (no automated test).`,
      );
    }

    if (personnel.length === 0) {
      high.push(
        "NO personnel in Drata. Add all team members — they need training, background checks, policy acks, and device compliance.",
      );
    }

    if (policies.length === 0) {
      high.push(
        "NO policies in Drata. Upload and distribute policies for acknowledgment.",
      );
    }

    if (connections.length === 0) {
      high.push(
        "NO integrations connected. Connect AWS, GitHub, Okta, Google Workspace for automated monitoring.",
      );
    }

    if (vendors.length === 0) {
      medium.push(
        "NO vendors in Drata. Add critical vendors (AWS, Okta, GitHub, etc.) and conduct risk assessments.",
      );
    }

    const notReady = filtered.filter((c) => !c.isReady);

    return {
      isError: false,
      result: {
        overview: {
          totalControls: filtered.length,
          readyControls: filtered.length - notReady.length,
          notReadyControls: notReady.length,
          readinessPercentage:
            filtered.length > 0
              ? Math.round(
                  ((filtered.length - notReady.length) / filtered.length) * 100,
                )
              : 0,
          totalMonitors: monitors.length,
          failingMonitors: failingMonitors.length,
          passingMonitors: monitors.filter(isMonitorPassing).length,
          totalPersonnel: personnel.length,
          totalVendors: vendors.length,
          totalPolicies: policies.length,
          totalConnections: connections.length,
        },
        semanticsNote:
          "Scope: control readiness/evidence/ownership/monitoring gaps (in-scope controls only) plus failing monitors bucketed by each monitor's own Drata priority (CRITICAL/HIGH/NORMAL/LOW). Personnel, vendors, policies, and connections are presence-checked only (count > 0) — personnel compliance, vendor review status, and device posture are NOT assessed here, so their absence from gaps does not mean no gap; use check_personnel_compliance, check_vendor_risk, and list_devices_v2." +
          (frameworkFilter
            ? " frameworkFilter scopes CONTROLS only; monitor and inventory numbers remain tenant-wide."
            : ""),
        gaps: { critical, high, medium, low },
        nextActions: generateNextActions(
          filtered,
          monitors,
          personnel,
          vendors,
          policies,
          connections,
        ),
      },
    };
  } catch (err) {
    return mapDrataError(err);
  }
}

function generateNextActions(
  controls: EnrichedControl[],
  monitors: Monitor[],
  personnel: unknown[],
  vendors: unknown[],
  policies: unknown[],
  connections: unknown[],
): string[] {
  const actions: string[] = [];

  if (connections.length === 0)
    actions.push(
      "PRIORITY 1: Connect integrations (AWS, GitHub, Okta, Google Workspace) to enable automated monitoring.",
    );
  if (personnel.length === 0)
    actions.push(
      "PRIORITY 1: Add all team members to Drata — training, background checks, policy acks, device agent.",
    );
  if (policies.length === 0)
    actions.push(
      "PRIORITY 1: Upload policies to Drata and distribute for acknowledgment.",
    );

  const noOwner = controls.filter((c) => !c.hasOwner);
  if (noOwner.length > 0)
    actions.push(
      `PRIORITY 2: Assign owners to ${noOwner.length} controls.`,
    );
  if (vendors.length === 0)
    actions.push(
      "PRIORITY 2: Add critical vendors and begin security assessments.",
    );

  const failing = monitors.filter(isMonitorFailing);
  if (failing.length > 0)
    actions.push(
      `PRIORITY 2: Fix ${failing.length} failing monitors: ${failing.map((m) => m.name).join(", ")}`,
    );

  const noEvidence = controls.filter((c) => !c.hasEvidence);
  if (noEvidence.length > 0)
    actions.push(
      `PRIORITY 3: Collect and upload evidence for ${noEvidence.length} controls.`,
    );

  if (actions.length === 0)
    actions.push("Looking good! Review individual controls for remaining gaps.");

  return actions;
}
