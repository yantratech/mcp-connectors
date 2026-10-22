import { getDrataClient } from "../clients/drata-client.js";
import { mapDrataError } from "../helpers/error-mapping.js";
import { matchesCode, normalizeCodes, projectFields } from "../helpers/field-selection.js";
import {
  V2_CONTROL_EXPANDS,
  enrichV2Control,
  normalizeTag,
  slimControl,
  type EnrichedControl,
  type V2Control,
} from "../helpers/v2-control-evidence.js";
import type { DrataClientResponse } from "../types/drata-client-response.js";

// These tools do not use the V1 /public/controls booleans: their
// `hasEvidence` only covers manually attached external evidence and
// evidence-library reports, so controls whose evidence comes from mapped
// policies or monitor tests (the majority in a well-connected workspace) would
// read as "no evidence" even though the app shows them with evidence. The V2
// controls list with expands exposes each evidence source, letting
// `no_evidence` mean what it means in the app: no evidence of ANY kind.

/**
 * Fetch every control enriched with app-equivalent evidence/readiness fields.
 * Archived controls are excluded unless `includeArchived` — the app's
 * per-framework counts (e.g. the SOC 2 "in scope" count) only cover live
 * controls.
 * Shared by check_control_status, run_gap_analysis, and
 * get_compliance_summary so all three report the same numbers as the app.
 */
export async function fetchEnrichedControls(options?: {
  workspaceId?: number;
  includeArchived?: boolean;
}): Promise<{ controls: EnrichedControl[]; archivedCount: number }> {
  const client = getDrataClient();
  const wId = await client.resolveOrFetchWorkspaceId(options?.workspaceId);
  const raw = await client.fetchAllV2<V2Control>(
    `/public/v2/workspaces/${wId}/controls`,
    { expand: V2_CONTROL_EXPANDS, size: 100 },
  );
  const archivedCount = raw.filter((c) => c.archivedAt !== null).length;
  const kept = options?.includeArchived
    ? raw
    : raw.filter((c) => c.archivedAt === null);
  return { controls: kept.map(enrichV2Control), archivedCount };
}

export async function checkControls(
  filter: string,
  frameworkFilter?: string,
  options?: {
    codes?: string[];
    fields?: string[];
    includeArchived?: boolean;
    workspaceId?: number;
  },
): Promise<DrataClientResponse<unknown>> {
  try {
    // Fetch WITH archived controls so the excluded-count can be scoped to the
    // same framework/codes filters as the returned controls.
    const { controls } = await fetchEnrichedControls({
      workspaceId: options?.workspaceId,
      includeArchived: true,
    });
    const codes = normalizeCodes(options?.codes);

    let scoped = controls;
    if (frameworkFilter) {
      const wanted = normalizeTag(frameworkFilter);
      scoped = scoped.filter((c) =>
        c.frameworkTags.some((tag) => normalizeTag(tag) === wanted),
      );
      if (scoped.length === 0) {
        const availableTags = [
          ...new Set(controls.flatMap((c) => c.frameworkTags)),
        ];
        return {
          isError: true,
          error: `No controls found for framework "${frameworkFilter}". Available: ${availableTags.join(", ")}`,
        };
      }
    }
    // A typo'd code must not read as a bare zero-summary: report requested
    // codes that match nothing. Checked before the archived filter, so a
    // code that exists but is archived shows up via archivedControlsExcluded
    // rather than here.
    let unmatchedCodes: string[] | undefined;
    if (codes) {
      const present = new Set(
        scoped.map((c) => String(c.code).trim().toUpperCase()),
      );
      const seen = new Set<string>();
      unmatchedCodes = [];
      for (const raw of options?.codes ?? []) {
        const trimmed = raw.trim();
        const normalized = trimmed.toUpperCase();
        if (!trimmed || seen.has(normalized)) continue;
        seen.add(normalized);
        if (!present.has(normalized)) unmatchedCodes.push(trimmed);
      }
    }
    scoped = scoped.filter((c) => matchesCode(c, codes));

    const archivedInScope = scoped.filter((c) => c.archivedAt !== null).length;
    const enriched = options?.includeArchived
      ? scoped
      : scoped.filter((c) => c.archivedAt === null);

    const summary = {
      totalControls: enriched.length,
      readyControls: enriched.filter((c) => c.isReady).length,
      controlsWithAnyEvidence: enriched.filter((c) => c.hasEvidence).length,
      archivedControlsExcluded: options?.includeArchived ? 0 : archivedInScope,
    };

    let result = enriched;
    switch (filter) {
      case "not_ready":
        result = result.filter((c) => !c.isReady);
        break;
      case "no_evidence":
        result = result.filter((c) => !c.hasEvidence);
        break;
      case "no_owner":
        result = result.filter((c) => !c.hasOwner);
        break;
      case "not_monitored":
        result = result.filter((c) => !c.isMonitored);
        break;
      case "ready":
        result = result.filter((c) => c.isReady);
        break;
    }

    const slim = !options?.fields || options.fields.length === 0;
    return {
      isError: false,
      result: {
        filter,
        ...(unmatchedCodes ? { unmatchedCodes } : {}),
        ...(unmatchedCodes && unmatchedCodes.length > 0
          ? {
              unmatchedCodesNote: `These requested codes match no control${frameworkFilter ? ` tagged "${frameworkFilter}"` : ""} in this workspace (archived controls included in the check) — check for typos or discover valid codes via list_controls.`,
            }
          : {}),
        count: result.length,
        summary,
        semanticsNote:
          "hasEvidence means evidence of ANY kind (external uploads, evidence-library reports, mapped policies, monitor tests) — matching the Drata app. Archived controls are excluded unless includeArchived is set.",
        ...(slim
          ? {
              projectionNote:
                'controls[] is a slim projection: id, code, name, isReady, isMonitored, hasEvidence, hasOwner (plus archivedAt on archived controls). Use fields to select more — e.g. fields:["code","evidence"] for the per-source evidence breakdown; frameworkTags and archivedAt are also available.',
            }
          : {}),
        controls: slim
          ? result.map(slimControl)
          : projectFields(
              result as unknown as Record<string, unknown>[],
              options?.fields,
            ),
      },
    };
  } catch (err) {
    return mapDrataError(err);
  }
}
