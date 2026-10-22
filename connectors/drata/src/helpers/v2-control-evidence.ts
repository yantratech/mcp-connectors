/**
 * Shared enrichment for V2 control objects fetched with
 * `expand=flags,evidenceIds,testIds,frameworkTags`.
 *
 * The V1 /public/controls (and V2 flags) `hasEvidence` boolean only covers
 * manually attached external evidence and evidence-library reports. The Drata
 * app's evidence view additionally counts mapped policies and monitor tests
 * (auto-collected evidence), so tools that answer "does this control have
 * evidence?" must aggregate all four sources.
 */

export interface V2ControlFlags {
  hasEvidence?: boolean;
  hasPolicy?: boolean;
  hasTicket?: boolean;
  isReady?: boolean;
  isMonitored?: boolean;
  hasOwner?: boolean;
}

export interface V2ControlEvidenceIds {
  validExternalEvidenceIds?: number[];
  invalidExternalEvidenceIds?: number[];
  validReportIds?: number[];
  invalidReportIds?: number[];
}

export interface V2ControlTestIds {
  passing?: number[];
  failing?: number[];
  monitored?: number[];
}

export interface V2Control {
  id: number;
  code: string;
  name: string;
  archivedAt: string | null;
  flags?: V2ControlFlags;
  evidenceIds?: V2ControlEvidenceIds;
  testIds?: V2ControlTestIds;
  frameworkTags?: string[];
}

export const V2_CONTROL_EXPANDS = [
  "flags",
  "evidenceIds",
  "testIds",
  "frameworkTags",
];

// V2 framework tags are enum-style ("SOC_2"); V1 and the app show "SOC 2".
// Compare on a normalized form so human-style filter values keep working.
export function normalizeTag(tag: string): string {
  return tag.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

export function humanizeTag(tag: string): string {
  return tag.replace(/_/g, " ");
}

function count(ids: number[] | undefined): number {
  return Array.isArray(ids) ? ids.length : 0;
}

export interface EnrichedControl {
  id: number;
  code: string;
  name: string;
  isReady: boolean;
  isMonitored: boolean;
  hasEvidence: boolean;
  hasOwner: boolean;
  frameworkTags: string[];
  archivedAt: string | null;
  evidence: {
    externalEvidenceCount: number;
    evidenceLibraryReportCount: number;
    hasMappedPolicy: boolean;
    monitorTestCount: number;
    passingTestCount: number;
    failingTestCount: number;
    drataHasEvidenceFlag: boolean;
  };
}

/**
 * Default per-control projection for check_control_status. A full
 * EnrichedControl serializes to ~550 chars; times the ~200 controls of a
 * typical SOC 2 workspace, that crosses MCP clients' truncation thresholds,
 * so the per-source `evidence` breakdown, frameworkTags, and archivedAt are
 * opt-in via fields[]. archivedAt is kept whenever it is set so archived
 * controls stay recognizable under includeArchived.
 */
export function slimControl(c: EnrichedControl): Record<string, unknown> {
  const slim: Record<string, unknown> = {
    id: c.id,
    code: c.code,
    name: c.name,
    isReady: c.isReady,
    isMonitored: c.isMonitored,
    hasEvidence: c.hasEvidence,
    hasOwner: c.hasOwner,
  };
  if (c.archivedAt !== null) slim.archivedAt = c.archivedAt;
  return slim;
}

export function enrichV2Control(c: V2Control): EnrichedControl {
  const flags = c.flags ?? {};
  const evidenceIds = c.evidenceIds ?? {};
  const testIds = c.testIds ?? {};
  const externalEvidenceCount =
    count(evidenceIds.validExternalEvidenceIds) +
    count(evidenceIds.invalidExternalEvidenceIds);
  const evidenceLibraryReportCount =
    count(evidenceIds.validReportIds) + count(evidenceIds.invalidReportIds);
  const hasMappedPolicy = flags.hasPolicy === true;
  const monitorTestCount = count(testIds.monitored);
  // "Evidence of any kind", matching what the app's control page lists:
  // external uploads, evidence-library reports, mapped policies, and
  // monitor tests (auto-collected evidence).
  const hasAnyEvidence =
    externalEvidenceCount > 0 ||
    evidenceLibraryReportCount > 0 ||
    hasMappedPolicy ||
    monitorTestCount > 0;
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    isReady: flags.isReady === true,
    isMonitored: flags.isMonitored === true,
    hasEvidence: hasAnyEvidence,
    hasOwner: flags.hasOwner === true,
    frameworkTags: (c.frameworkTags ?? []).map(humanizeTag),
    archivedAt: c.archivedAt,
    evidence: {
      externalEvidenceCount,
      evidenceLibraryReportCount,
      hasMappedPolicy,
      monitorTestCount,
      passingTestCount: count(testIds.passing),
      failingTestCount: count(testIds.failing),
      // Drata's own narrow flag: external evidence / reports only. Kept
      // for transparency; it is NOT what the app's evidence view counts.
      drataHasEvidenceFlag: flags.hasEvidence === true,
    },
  };
}
