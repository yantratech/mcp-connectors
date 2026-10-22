import {
  getDrataClient,
  flattenPersonnel,
  compactPersonnel,
} from "../clients/drata-client.js";
import { mapDrataError } from "../helpers/error-mapping.js";
import type { Personnel } from "../clients/drata-client.js";
import type { DrataClientResponse } from "../types/drata-client-response.js";

// Drata's V1 /public/personnel response carries an authoritative per-person
// complianceChecks array (types like ACCEPTED_POLICIES, BG_CHECK,
// SECURITY_TRAINING, AGENT_INSTALLED, HDD_ENCRYPTION, ...; statuses
// PASS / FAIL / EXCLUDED, plus a FULL_COMPLIANCE rollup). All compliance
// signals here are read from those checks — never from proxies like
// drataTermsAgreedAt (which only records the person clicking Drata's own
// Terms of Service, NOT policy acknowledgement) or raw document/bg-check
// history, both of which can disagree with the Drata app.
interface RawComplianceCheck {
  type?: string;
  status?: string;
}

interface EnrichedPersonnel {
  id: number;
  userId: number | null;
  name: string;
  email: string | null;
  employmentStatus: string;
  isCompliant: boolean | null;
  missingPolicyAck: boolean;
  missingBackgroundCheck: boolean;
  missingSecurityTraining: boolean;
  record: Record<string, unknown>;
}

interface PersonnelSummaryRef {
  id: number;
  userId: number | null;
  name: string;
  email: string | null;
  employmentStatus: string;
}

const SEMANTICS_NOTE =
  "All compliance signals mirror Drata's own per-person complianceChecks: " +
  "isCompliant is the FULL_COMPLIANCE rollup; missingPolicyAck / " +
  "missingBgCheck / missingTraining are the ACCEPTED_POLICIES / BG_CHECK / " +
  "SECURITY_TRAINING checks (FAIL = missing; EXCLUDED = not required for " +
  "that person, never counted as missing). failedChecks lists every check " +
  "type Drata reports as FAIL, including device/agent posture " +
  "(AGENT_INSTALLED, HDD_ENCRYPTION, ANTIVIRUS, ...) and checks the tenant " +
  "may not require — a person can be isCompliant:true with e.g. " +
  "HIPAA_TRAINING failing — so treat isCompliant, not failedChecks, as the " +
  "verdict. Records without complianceChecks data score isCompliant:null " +
  "and are counted under unknownComplianceCount, not assumed non-compliant. " +
  "Compliance counts cover current employees/contractors only unless " +
  "includeNonCurrent is set; non-current records are summarized under " +
  "nonCurrent.";

function checkStatuses(p: Personnel): Map<string, string> {
  const raw = Array.isArray(p.complianceChecks)
    ? (p.complianceChecks as RawComplianceCheck[])
    : [];
  const map = new Map<string, string>();
  for (const c of raw) {
    if (c && typeof c.type === "string" && typeof c.status === "string") {
      map.set(c.type, c.status);
    }
  }
  return map;
}

function enrich(p: Personnel, fields?: string[]): EnrichedPersonnel {
  const flat = flattenPersonnel(p);
  const checks = checkStatuses(p);

  const status = (type: string): string | null => checks.get(type) ?? null;
  const full = status("FULL_COMPLIANCE");
  const isCompliant = full === "PASS" ? true : full === "FAIL" ? false : null;
  const missingPolicyAck = status("ACCEPTED_POLICIES") === "FAIL";
  const missingBackgroundCheck = status("BG_CHECK") === "FAIL";
  const missingSecurityTraining = status("SECURITY_TRAINING") === "FAIL";

  const failedChecks = [...checks.entries()]
    .filter(([type, s]) => type !== "FULL_COMPLIANCE" && s === "FAIL")
    .map(([type]) => type)
    .sort();
  const excludedChecks = [...checks.entries()]
    .filter(([, s]) => s === "EXCLUDED")
    .map(([type]) => type)
    .sort();

  const record = compactPersonnel(flat, fields);
  // drataTermsAgreedAt records the person clicking Drata's own ToS at first
  // portal login — only admins ever do. It says nothing about policy
  // acknowledgement and is easily misread as such, so it is dropped entirely.
  delete record.termsAgreed;
  record.devicesCount =
    typeof p.devicesCount === "number" ? p.devicesCount : null;
  record.isCompliant = isCompliant;
  record.missingPolicyAck = missingPolicyAck;
  record.missingBackgroundCheck = missingBackgroundCheck;
  record.missingSecurityTraining = missingSecurityTraining;
  record.failedChecks = failedChecks;
  record.excludedChecks = excludedChecks;
  if (fields?.includes("complianceChecks")) {
    record.complianceChecks = p.complianceChecks ?? [];
  }

  return {
    id: flat.id,
    userId: flat.userId,
    name:
      [flat.firstName, flat.lastName].filter(Boolean).join(" ") || "(unknown)",
    email: flat.email,
    employmentStatus: flat.employmentStatus,
    isCompliant,
    missingPolicyAck,
    missingBackgroundCheck,
    missingSecurityTraining,
    record,
  };
}

function summaryRef(e: EnrichedPersonnel): PersonnelSummaryRef {
  return {
    id: e.id,
    userId: e.userId,
    name: e.name,
    email: e.email,
    employmentStatus: e.employmentStatus,
  };
}

export async function checkPersonnel(options?: {
  includeNonCurrent?: boolean;
  fields?: string[];
}): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const personnel = await client.getPersonnel();

    if (personnel.length === 0) {
      return {
        isError: false,
        result: {
          status: "NO_PERSONNEL",
          message:
            "No personnel in Drata. Add team members — they need training, background check, policy acks, and device agent.",
          totalPersonnel: 0,
          scoredPersonnel: 0,
          compliantCount: 0,
          nonCompliantCount: 0,
          unknownComplianceCount: 0,
          missingTraining: [],
          missingBgCheck: [],
          missingPolicyAck: [],
          personnel: [],
        },
      };
    }

    const enriched = personnel.map((p) => enrich(p, options?.fields));
    const isCurrent = (e: EnrichedPersonnel): boolean =>
      e.employmentStatus.startsWith("CURRENT");
    const nonCurrent = enriched.filter((e) => !isCurrent(e));
    const scored = options?.includeNonCurrent
      ? enriched
      : enriched.filter(isCurrent);

    const byStatus: Record<string, number> = {};
    for (const e of nonCurrent) {
      byStatus[e.employmentStatus] = (byStatus[e.employmentStatus] ?? 0) + 1;
    }
    const nonCurrentSection =
      nonCurrent.length === 0
        ? undefined
        : options?.includeNonCurrent
          ? {
              total: nonCurrent.length,
              byStatus,
              note: "Included in the compliance counts above (includeNonCurrent=true); check employmentStatus on each entry before treating a gap as actionable.",
            }
          : {
              total: nonCurrent.length,
              byStatus,
              note: "NOT scored in the compliance counts above — former employees, service accounts, and bots are not actionable compliance gaps at face value. Set includeNonCurrent:true to score them.",
              personnel: nonCurrent.map((e) => ({
                ...summaryRef(e),
                isCompliant: e.isCompliant,
              })),
            };

    return {
      isError: false,
      result: {
        totalPersonnel: enriched.length,
        scoredPersonnel: scored.length,
        compliantCount: scored.filter((e) => e.isCompliant === true).length,
        nonCompliantCount: scored.filter((e) => e.isCompliant === false)
          .length,
        unknownComplianceCount: scored.filter((e) => e.isCompliant === null)
          .length,
        semanticsNote: SEMANTICS_NOTE,
        missingTraining: scored
          .filter((e) => e.missingSecurityTraining)
          .map(summaryRef),
        missingBgCheck: scored
          .filter((e) => e.missingBackgroundCheck)
          .map(summaryRef),
        missingPolicyAck: scored
          .filter((e) => e.missingPolicyAck)
          .map(summaryRef),
        ...(nonCurrentSection ? { nonCurrent: nonCurrentSection } : {}),
        personnel: scored.map((e) => e.record),
      },
    };
  } catch (err) {
    return mapDrataError(err);
  }
}
