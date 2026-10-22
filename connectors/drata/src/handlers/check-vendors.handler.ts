import { getDrataClient } from "../clients/drata-client.js";
import { mapDrataError } from "../helpers/error-mapping.js";
import { resolveVendorReviewEvidence } from "./vendor-review-evidence.js";
import type { DrataClientResponse } from "../types/drata-client-response.js";

export async function checkVendors(): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const vendors = await client.getVendors();

    if (vendors.length === 0) {
      return {
        isError: false,
        result: {
          status: "NO_VENDORS",
          message:
            "No vendors in Drata. Add critical vendors and conduct risk assessments. suggestedVendorCategories lists common starting points; add the vendors your organisation actually uses in each.",
          // Generic categories, not specific products: the caller decides which
          // vendors in each category apply to their organisation.
          suggestedVendorCategories: [
            "Cloud infrastructure provider",
            "Identity provider / SSO",
            "Source control and CI/CD",
            "Email and collaboration suite",
            "Password manager",
            "Project management",
            "Documentation / wiki",
            "Accounting / finance system",
            "Team chat",
          ],
        },
      };
    }

    const reviewEvidence = await resolveVendorReviewEvidence(vendors);
    const trimmed = vendors.map((v) => {
      const evidence = reviewEvidence.get(v.id);
      const reviews = evidence?.reviews ?? [];
      const completed = reviews.filter((r) => r.status === "COMPLETED").length;
      const pending = reviews.filter(
        (r) => r.status !== null && r.status !== "COMPLETED",
      ).length;
      // Fallback-only detections (event log / vendor notes) plus records
      // missing a status field: a review may exist but its status is
      // unknowable, so it must not read as either completed or absent.
      const unverifiable =
        Math.max(0, (evidence?.reviewCount ?? 0) - reviews.length) +
        reviews.filter((r) => r.status === null).length;
      // archivedAt is the reliable archived signal; upstream `status` is null
      // for most active vendors.
      const archivedAt = (v.archivedAt as string | null | undefined) ?? null;
      return {
        id: v.id,
        name: v.name,
        archived: archivedAt != null,
        archivedAt,
        critical: v.critical ?? false,
        risk: v.risk ?? "NONE",
        impactLevel: v.impactLevel ?? "UNSCORED",
        hasPii: v.hasPii ?? false,
        passwordPolicy: v.passwordPolicy ?? null,
        passwordMfaEnabled: v.passwordMfaEnabled ?? false,
        completedReviewCount: completed,
        pendingReviewCount: pending,
        unverifiableReviewCount: unverifiable,
        reviewSources: evidence?.reviewSources ?? [],
        reviewIds: evidence?.reviewIds ?? [],
        eventIds: evidence?.eventIds ?? [],
        hasPrivacyUrl: v.privacyUrl != null,
        hasTermsUrl: v.termsUrl != null,
      };
    });

    const active = trimmed.filter((v) => !v.archived);
    const activeWithoutCompletedReview = active.filter(
      (v) => v.completedReviewCount === 0 && v.unverifiableReviewCount === 0,
    );

    return {
      isError: false,
      result: {
        totalVendors: trimmed.length,
        activeVendors: active.length,
        archivedVendorsIncluded: trimmed.length - active.length,
        activeVendorsWithoutCompletedReview: activeWithoutCompletedReview.length,
        criticalActiveVendorsWithoutCompletedReview:
          activeWithoutCompletedReview.filter((v) => v.critical).length,
        activeVendorsWithUnknownReviewStatus: active.filter(
          (v) => v.completedReviewCount === 0 && v.unverifiableReviewCount > 0,
        ).length,
        semanticsNote:
          "completedReviewCount counts only COMPLETED security reviews — the Drata app's definition of a past review. Scheduled shells (NOT_YET_STARTED/NOT_REQUIRED) and in-progress reviews are pendingReviewCount; fallback detections whose status is unknowable are unverifiableReviewCount. Archived vendors are included but marked archived: true — exclude them from operational counts. For app-equivalent per-vendor review status use list_vendor_security_review_statuses.",
        sourceNote:
          "reviewSources values: api_list (official per-vendor list endpoint, primary); api_expand (vendor payload) and persisted_get_by_id (deprecated local state, for IDs the list did not return), checked for every vendor; event_log and vendor_notes, used only when the vendor's list call fails.",
        vendors: trimmed,
      },
    };
  } catch (err) {
    return mapDrataError(err);
  }
}
