/**
 * Drata plan-entitlement detection.
 *
 * Some Drata endpoints are gated behind paid add-ons and return HTTP 402
 * ("You must upgrade your plan to use this feature.") rather than data. A 402
 * means the *account/plan feature* is missing — distinct from 403, which would
 * mean the API token lacks a permission. We probe one endpoint per feature
 * group at startup so the connector can flag (or hide) the affected tools
 * instead of advertising them identically to working ones.
 *
 * Detection is fail-open: only a definitive 402 marks a group unentitled. A
 * network error, timeout, 200, or any other status leaves the group entitled,
 * so a transient blip never wrongly hides a tool and a future plan upgrade
 * auto-restores the group with no code change.
 */

export interface EntitlementGroup {
  /** Stable identifier used to key detection results. */
  id: string;
  /** Human name of the Drata feature/add-on that gates the group. */
  featureName: string;
  /** Base-tier tools a caller should use instead. */
  baseTierAlternative: string;
  /** Endpoint probed once at startup; a 402 marks the group unentitled. */
  probePath: string;
  /** Substring(s) that identify this group's endpoints in an error path. */
  pathMarkers: readonly string[];
  /** Tools that hit this feature's endpoints (snake_case, matching the registry). */
  toolNames: ReadonlySet<string>;
}

export const ENTITLEMENT_GROUPS: readonly EntitlementGroup[] = [
  {
    id: "risk-management-pro",
    featureName: "Risk Management Pro",
    baseTierAlternative:
      "list_risks, get_risk, list_risk_notes (base-tier risk reads work without Pro; pass riskRegisterId or set DRATA_RISK_REGISTER_ID)",
    probePath: "/public/v2/risk-registers",
    pathMarkers: ["/risk-registers"],
    toolNames: new Set([
      // Reads that return 402 without the add-on:
      "list_risk_registers",
      "get_risk_insights",
      "list_risk_documents",
      // Same Risk-Register management surface (writes to the gated feature):
      "create_risk_register",
      "update_risk_register",
      "upload_risk_document",
    ]),
  },
  {
    id: "custom-connections",
    featureName: "Custom Connections / Custom Data",
    baseTierAlternative:
      "list_connections (read-only inventory of configured integrations)",
    probePath: "/public/v2/custom-connections",
    pathMarkers: ["/custom-connections"],
    toolNames: new Set([
      // Reads that return 402 without the add-on:
      "list_custom_connections",
      "list_custom_data_records",
      "list_custom_data_records_sessions",
      // Same custom-connection surface (writes to the gated feature):
      "create_custom_connection",
      "push_connection_records",
      "upsert_custom_data_records",
      "upsert_custom_data_records_session",
      "perform_custom_data_session_action",
      "update_custom_data_record",
      "delete_custom_data_record",
    ]),
  },
];

const TOOL_TO_GROUP: ReadonlyMap<string, EntitlementGroup> = (() => {
  const map = new Map<string, EntitlementGroup>();
  for (const group of ENTITLEMENT_GROUPS) {
    for (const name of group.toolNames) map.set(name, group);
  }
  return map;
})();

export function groupForTool(toolName: string): EntitlementGroup | undefined {
  return TOOL_TO_GROUP.get(toolName);
}

/**
 * Identify which gated feature an error path belongs to, for 402 messaging.
 * A 402 on one of these paths is unambiguous: base-tier endpoints return data,
 * so a 402 means the whole feature is off for the account.
 */
export function featureForPath(
  path: string,
): Pick<EntitlementGroup, "featureName" | "baseTierAlternative"> | undefined {
  for (const group of ENTITLEMENT_GROUPS) {
    if (group.pathMarkers.some((marker) => path.includes(marker))) {
      return {
        featureName: group.featureName,
        baseTierAlternative: group.baseTierAlternative,
      };
    }
  }
  return undefined;
}

/** Loud, impossible-to-miss prefix for an unentitled tool's description. */
export function unavailableMarker(group: EntitlementGroup): string {
  return (
    `⛔ UNAVAILABLE ON THIS PLAN (requires Drata "${group.featureName}"). ` +
    `Calling this returns HTTP 402. Use ${group.baseTierAlternative} instead.`
  );
}

export interface EntitlementProbe {
  probeHttpStatus(path: string, timeoutMs?: number): Promise<number | null>;
}

/**
 * Probe each feature group once. Returns the set of group ids that are
 * unentitled (probe returned 402). Fail-open on everything else.
 */
export async function detectUnentitledGroups(
  client: EntitlementProbe,
): Promise<Set<string>> {
  const unentitled = new Set<string>();
  await Promise.all(
    ENTITLEMENT_GROUPS.map(async (group) => {
      const status = await client.probeHttpStatus(`${group.probePath}?size=1`);
      if (status === 402) unentitled.add(group.id);
    }),
  );
  return unentitled;
}
