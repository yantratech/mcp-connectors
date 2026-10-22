import { getDrataClient } from "../clients/drata-client.js";
import { mapDrataError } from "../helpers/error-mapping.js";
import {
  resolveVendorReviewEvidence,
  type VendorReviewRecord,
} from "./vendor-review-evidence.js";
import type { Vendor } from "../clients/drata-client.js";
import type { DrataClientResponse } from "../types/drata-client-response.js";

interface VendorReviewSummary {
  id: number;
  name: string;
  archived: boolean;
  critical: boolean;
  risk: string;
  impactLevel: string;
  hasPii: boolean;
}

function trim(v: Vendor): VendorReviewSummary {
  return {
    id: v.id,
    name: v.name,
    // archivedAt is the reliable archived signal; upstream `status` is null
    // for most active vendors.
    archived: (v.archivedAt as string | null | undefined) != null,
    critical: (v.critical as boolean) ?? false,
    risk: (v.risk as string) ?? "NONE",
    impactLevel: (v.impactLevel as string) ?? "UNSCORED",
    hasPii: (v.hasPii as boolean) ?? false,
  };
}

// The Drata app's "Security review status" column counts only COMPLETED
// reviews as past reviews. NOT_YET_STARTED / NOT_REQUIRED records with
// decision PENDING are scheduled shells the app shows as "No past review".
const COMPLETED = "COMPLETED";
const SHELL_STATUSES = new Set(["NOT_YET_STARTED", "NOT_REQUIRED"]);

function latestCompleted(
  reviews: VendorReviewRecord[],
): VendorReviewRecord | null {
  const completed = reviews.filter((r) => r.status === COMPLETED);
  if (completed.length === 0) return null;
  // ISO timestamps compare lexicographically; fall back to the higher review
  // id when requestedAt is missing so "latest" stays deterministic.
  return completed.reduce((latest, r) => {
    const a = r.requestedAt ?? "";
    const b = latest.requestedAt ?? "";
    if (a !== b) return a > b ? r : latest;
    return (r.id ?? 0) > (latest.id ?? 0) ? r : latest;
  });
}

// Per-review detail is opt-in via fields[] to keep the default payload
// compact — the counts and latest decision cover the common questions.
const DETAIL_FIELDS = ["reviews", "latestCompletedReview"] as const;

export async function checkVendorSecurityReviews(options?: {
  fields?: string[];
}): Promise<DrataClientResponse<unknown>> {
  try {
    const requested = new Set(
      (options?.fields ?? []).map((field) => field.trim()),
    );
    const unsupported = [...requested].filter(
      (field) => !(DETAIL_FIELDS as readonly string[]).includes(field),
    );
    if (unsupported.length > 0) {
      return {
        isError: true,
        error: `Unsupported fields: ${unsupported.join(", ")}. Supported detail fields: ${DETAIL_FIELDS.join(", ")}.`,
      };
    }
    const includeReviews = requested.has("reviews");
    const includeLatest = requested.has("latestCompletedReview");
    const client = getDrataClient();
    // V2 with expand=reviews returns the full review array per vendor. Fall
    // back to V1 if V2 is unavailable or doesn't surface the field.
    const v2Vendors = await client
      .fetchAllV2<Vendor>("/public/v2/vendors", { expand: ["reviews"] })
      .catch(() => null);
    const v1Vendors = await client.getVendors();

    const merged = new Map<number, VendorReviewSummary>();
    const rawVendors = new Map<number, Vendor>();
    for (const v of v1Vendors) {
      merged.set(v.id, trim(v));
      rawVendors.set(v.id, v);
    }
    if (v2Vendors) {
      for (const v of v2Vendors) {
        const v2Trim = trim(v);
        const existing = merged.get(v.id);
        rawVendors.set(v.id, { ...(rawVendors.get(v.id) ?? {}), ...v });
        if (!existing) {
          merged.set(v.id, v2Trim);
          continue;
        }
        merged.set(v.id, {
          ...existing,
          ...v2Trim,
          archived: v2Trim.archived || existing.archived,
          critical: v2Trim.critical || existing.critical,
          risk: v2Trim.risk !== "NONE" ? v2Trim.risk : existing.risk,
          impactLevel:
            v2Trim.impactLevel !== "UNSCORED"
              ? v2Trim.impactLevel
              : existing.impactLevel,
          hasPii: v2Trim.hasPii || existing.hasPii,
        });
      }
    }

    const evidence = await resolveVendorReviewEvidence([...rawVendors.values()]);
    const results = [...merged.values()].map((vendor) => {
      const reviewEvidence = evidence.get(vendor.id);
      const reviews = reviewEvidence?.reviews ?? [];
      const completedReviews = reviews.filter((r) => r.status === COMPLETED);
      const shellReviews = reviews.filter(
        (r) => r.status !== null && SHELL_STATUSES.has(r.status),
      );
      const statuslessReviews = reviews.filter((r) => r.status === null);
      const otherReviews = reviews.filter(
        (r) =>
          r.status !== null &&
          r.status !== COMPLETED &&
          !SHELL_STATUSES.has(r.status),
      );
      // Review records whose status is unknowable — event-log/vendor-notes
      // detections (no record at all) and API records missing a status field —
      // must surface as UNKNOWN, never as "no past review": the review may
      // well be completed.
      const fallbackOnlyCount = Math.max(
        0,
        (reviewEvidence?.reviewCount ?? 0) - reviews.length,
      );
      const unverifiableCount = fallbackOnlyCount + statuslessReviews.length;
      const latest = latestCompleted(reviews);
      const securityReviewStatus =
        completedReviews.length > 0
          ? "UP_TO_DATE"
          : unverifiableCount > 0
            ? "UNKNOWN"
            : "NO_PAST_REVIEW";
      // The app's column can additionally show "Needs review" for vendors
      // with an OPEN scheduled review approaching its deadline; expose the
      // raw signals so callers can apply their own threshold.
      const openDeadlines = shellReviews
        .filter((r) => r.status === "NOT_YET_STARTED")
        .map((r) => r.reviewDeadlineAt)
        .filter((d): d is string => typeof d === "string")
        .sort();
      return {
        ...vendor,
        securityReviewStatus,
        decision: latest?.decision ?? null,
        completedReviewCount: completedReviews.length,
        pendingReviewCount:
          shellReviews.length + otherReviews.length + statuslessReviews.length,
        openReviewCount: shellReviews.filter((r) => r.status === "NOT_YET_STARTED")
          .length,
        nextReviewDeadlineAt: openDeadlines[0] ?? null,
        totalReviewRecords: reviews.length + fallbackOnlyCount,
        ...(includeLatest
          ? {
              latestCompletedReview: latest
                ? {
                    id: latest.id,
                    title: latest.title,
                    decision: latest.decision,
                    requestedAt: latest.requestedAt,
                    reviewDeadlineAt: latest.reviewDeadlineAt,
                  }
                : null,
            }
          : {}),
        ...(includeReviews
          ? {
              reviews: reviews.map((r) => ({
                id: r.id,
                status: r.status,
                decision: r.decision,
                title: r.title,
              })),
            }
          : {}),
        reviewSources: reviewEvidence?.reviewSources ?? [],
        eventIds: reviewEvidence?.eventIds ?? [],
      };
    });

    const upToDate = results.filter(
      (r) => r.securityReviewStatus === "UP_TO_DATE",
    );
    const noPastReview = results.filter(
      (r) => r.securityReviewStatus === "NO_PAST_REVIEW",
    );
    const unknown = results.filter((r) => r.securityReviewStatus === "UNKNOWN");

    return {
      isError: false,
      result: {
        totalVendors: results.length,
        // Corrected semantics: a vendor "has reviews" only when at least one
        // review is COMPLETED — matching the app's "Up to date" column.
        // Scheduled shells (NOT_YET_STARTED / NOT_REQUIRED, decision PENDING)
        // no longer count.
        vendorsWithReviews: upToDate.length,
        vendorsWithoutReviews: noPastReview.length,
        vendorsWithUnknownStatus: unknown.length,
        vendorsWithPendingShellsOnly: noPastReview.filter(
          (r) => r.pendingReviewCount > 0,
        ).length,
        archivedVendorsIncluded: results.filter((r) => r.archived).length,
        semanticsNote:
          "vendorsWithReviews counts vendors with >=1 COMPLETED security review (the app's 'Up to date' + 'Needs review' rows, both of which have a past review). Vendors whose only reviews are NOT_YET_STARTED/NOT_REQUIRED shells count as 'No past review' (vendorsWithoutReviews); their shells appear in pendingReviewCount. The app shows 'Needs review' for vendors whose open scheduled review approaches its deadline — derive it from openReviewCount + nextReviewDeadlineAt. UNKNOWN means review evidence exists but its status is unknowable (fallback sources, or records missing a status field). Archived vendors are included but marked archived: true — an archived vendor in needsReview is not an actionable gap.",
        detailNote:
          'Per-vendor entries are compact by default. Pass fields: ["reviews"] and/or ["latestCompletedReview"] for per-review status/decision detail; the latest completed decision is always present as `decision`.',
        sourceNote:
          "reviewSources values: api_list (official per-vendor list endpoint, primary); api_expand (vendor payload) and persisted_get_by_id (deprecated local state, for IDs the list did not return), checked for every vendor; event_log and vendor_notes, used only when the vendor's list call fails.",
        hasReviews: upToDate,
        needsReview: noPastReview,
        unknownStatus: unknown,
      },
    };
  } catch (err) {
    return mapDrataError(err);
  }
}
