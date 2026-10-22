import {
  getDrataClient,
  flattenPersonnel,
  compactPersonnel,
  type Vendor,
} from "../clients/drata-client.js";
import { mapDrataError } from "../helpers/error-mapping.js";
import { matchesCode, normalizeCodes, projectFields } from "../helpers/field-selection.js";
import type { DrataClientResponse } from "../types/drata-client-response.js";

export async function listControls(
  frameworkFilter?: string,
  options?: { codes?: string[]; fields?: string[]; includeArchived?: boolean },
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const controls = await client.getControls();
    const codes = normalizeCodes(options?.codes);
    const scoped = (frameworkFilter
      ? controls.filter((c) => c.frameworkTags.includes(frameworkFilter))
      : controls).filter((c) => matchesCode(c, codes));

    if (frameworkFilter && scoped.length === 0) {
      const availableTags = [
        ...new Set(controls.flatMap((c) => c.frameworkTags)),
      ];
      return {
        isError: true,
        error: `No controls found for framework "${frameworkFilter}". Available: ${availableTags.join(", ")}`,
      };
    }

    // Silently dropping unknown codes[] entries masked typos: the total just
    // shrank with no hint that a requested control was never found.
    const unmatchedCodes = codes
      ? [...codes].filter(
          (code) =>
            !controls.some(
              (c) => String(c.code ?? "").trim().toUpperCase() === code,
            ),
        )
      : [];

    const archivedInScope = scoped.filter((c) => c.archivedAt != null).length;
    const kept = options?.includeArchived
      ? scoped
      : scoped.filter((c) => c.archivedAt == null);

    return {
      isError: false,
      result: {
        total: kept.length,
        excludedArchived: options?.includeArchived ? 0 : archivedInScope,
        ...(unmatchedCodes.length > 0 ? { unmatchedCodes } : {}),
        semanticsNote:
          "hasEvidence is Drata's narrow V1 flag: it counts only manually uploaded external evidence and evidence-library reports — evidence from mapped policies and monitor tests is NOT counted. Use check_control_status for app-equivalent evidence coverage. Archived (out-of-scope) controls are excluded unless includeArchived is set.",
        controls: projectFields(kept.map((c) => {
          const row: Record<string, unknown> = {
            id: c.id,
            code: c.code,
            name: c.name,
            isReady: c.isReady,
            isMonitored: c.isMonitored,
            hasEvidence: c.hasEvidence,
            hasOwner: c.hasOwner,
            frameworkTags: c.frameworkTags,
          };
          if (options?.includeArchived) {
            row.isArchived = c.archivedAt != null;
            row.archivedAt = c.archivedAt;
          }
          return row;
        }), options?.fields),
      },
    };
  } catch (err) {
    return mapDrataError(err);
  }
}

export async function listMonitors(): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const monitors = await client.getMonitors();
    return {
      isError: false,
      result: {
        total: monitors.length,
        monitors: monitors.map((m) => ({
          id: m.id,
          name: m.name,
          status: m.checkResultStatus,
          enabled: m.checkStatus === "ENABLED",
          priority: m.priority,
          lastCheck: m.lastCheck,
        })),
      },
    };
  } catch (err) {
    return mapDrataError(err);
  }
}

export async function listPersonnel(
  options?: { fields?: string[] },
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const personnel = await client.getPersonnel();
    const rows = personnel.map((p) => {
      const row = compactPersonnel(flattenPersonnel(p), options?.fields);
      // Drata's authoritative per-person check verdicts ride along in the
      // same V1 payload; surface them as a compact {TYPE: STATUS} map so the
      // listing carries real compliance status instead of proxies.
      const rawChecks = p.complianceChecks;
      const checks = Array.isArray(rawChecks)
        ? (rawChecks as { type?: unknown; status?: unknown }[])
        : [];
      row.complianceChecks = Object.fromEntries(
        checks
          .filter((c) => typeof c?.type === "string")
          .map((c) => [c.type as string, c.status ?? null]),
      );
      return row;
    });
    return {
      isError: false,
      result: {
        total: personnel.length,
        semanticsNote:
          "complianceChecks is Drata's own per-person verdict map (PASS/FAIL/EXCLUDED; FULL_COMPLIANCE is the rollup — EXCLUDED means not applicable, not missing). termsAgreed only means the person clicked Drata's terms of use at portal login; it is NOT policy acknowledgement — use complianceChecks.ACCEPTED_POLICIES for that.",
        personnel: projectFields(rows, options?.fields),
      },
    };
  } catch (err) {
    return mapDrataError(err);
  }
}

export async function listVendors(
  params?: { size?: number; page?: number; fields?: string[] },
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const all = await client.getVendors();
    // `status` is null on most vendor records in the wild; archivedAt is the
    // reliable archived marker. Keep archived rows (marked) rather than
    // dropping them so name lookups still find archived shells/duplicates.
    const enriched: (Vendor & { isArchived: boolean })[] = all.map((v) => ({
      ...v,
      isArchived: v.archivedAt != null || v.status === "ARCHIVED",
    }));
    const archivedTotal = enriched.filter((v) => v.isArchived).length;
    const limit = params?.size ?? 50;
    const page = params?.page ?? 1;
    const start = (page - 1) * limit;
    const slice = enriched.slice(start, start + limit);
    // Full vendor records carry long prose (servicesProvided, dataStored,
    // password policy…) — ~3.5KB each — so the old return-everything default
    // exceeded MCP output caps and got silently truncated. Compact rows by
    // default; any raw field is opt-in via fields[].
    const rows =
      params?.fields && params.fields.length > 0
        ? projectFields(slice, params.fields)
        : slice.map((v) => ({
            id: v.id,
            name: v.name,
            category: v.category,
            risk: v.risk,
            critical: v.critical,
            impactLevel: v.impactLevel,
            isArchived: v.isArchived,
          }));
    return {
      isError: false,
      result: {
        total: enriched.length,
        activeTotal: enriched.length - archivedTotal,
        archivedTotal,
        returned: slice.length,
        page,
        limit,
        hasMore: start + limit < enriched.length,
        note: "Compact rows by default (id, name, category, risk, critical, impactLevel, isArchived). Opt in to any raw vendor field via fields[] (e.g. [\"id\", \"name\", \"dataStored\"]) or fetch one full record with get_vendor.",
        vendors: rows,
      },
    };
  } catch (err) {
    return mapDrataError(err);
  }
}

export async function listPolicies(): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const policies = await client.getPolicies();
    return { isError: false, result: { total: policies.length, policies } };
  } catch (err) {
    return mapDrataError(err);
  }
}

export async function listAssets(
  params?: { size?: number; page?: number; includeRemoved?: boolean },
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    // Default size 20 because asset records are verbose (~45 lines each).
    // Drata's V1 `total` field is unreliable on the EU instance — it
    // returns a sentinel like 9999999 even when the real workspace count
    // is small. Auto-merge to count honestly, then slice for the
    // requested page.
    const limit = params?.size ?? 20;
    const page = params?.page ?? 1;
    const all = await client.getAssets();
    // The V1 list keeps offboarded/deprovisioned assets forever with
    // `removedAt` set (they can be the large majority); the Drata app's
    // inventory count covers live assets only. Exclude removed by default
    // so `total` matches the app.
    const removedTotal = all.filter((a) => a.removedAt != null).length;
    const scope = params?.includeRemoved
      ? all
      : all.filter((a) => a.removedAt == null);
    const start = (page - 1) * limit;
    const slice = scope.slice(start, start + limit);
    return {
      isError: false,
      result: {
        total: scope.length,
        activeTotal: all.length - removedTotal,
        removedTotal,
        returned: slice.length,
        page,
        limit,
        hasMore: start + limit < scope.length,
        note: params?.includeRemoved
          ? "Includes removed (offboarded) assets — any row with removedAt set is no longer live."
          : "Removed (offboarded) assets are excluded; `total` matches the Drata app's live asset inventory. Set includeRemoved: true to page through removed assets too.",
        assets: slice,
      },
    };
  } catch (err) {
    return mapDrataError(err);
  }
}

export async function listConnections(): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const connections = await client.getConnections();
    // Drata reports `connected: true` even for MISCONFIGURED /
    // CONFIGURED_PENDING_CONFIRMATION integrations. Derive a real
    // health signal from `state` + `failedAt`.
    const enriched = connections.map((c) => {
      const state = (c.state as string | undefined) ?? null;
      const failedAt = (c.failedAt as string | null | undefined) ?? null;
      const rawConnected = c.connected as boolean | undefined;
      const isHealthy = state === "ACTIVE" && !failedAt;
      const connected =
        rawConnected === true && !failedAt && state !== "MISCONFIGURED";
      return { ...c, connected, isHealthy };
    });
    const healthyCount = enriched.filter((c) => c.isHealthy).length;
    return {
      isError: false,
      result: {
        total: enriched.length,
        healthyConnections: healthyCount,
        unhealthyConnections: enriched.length - healthyCount,
        connections: enriched,
      },
    };
  } catch (err) {
    return mapDrataError(err);
  }
}
