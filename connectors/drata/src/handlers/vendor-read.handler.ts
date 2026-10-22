import { getDrataClient } from "../clients/drata-client.js";
import { mapDrataError } from "../helpers/error-mapping.js";
import type { DrataClientResponse } from "../types/drata-client-response.js";

export async function getVendor(
  vendorId: number,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const vendor = await client.getVendor(vendorId);
    // Upstream's single-vendor GET never populates review data: `reviews` and
    // `latestSecurityReviews` are always [] even for vendors with COMPLETED
    // reviews, and the list endpoint's `securityReview` embed is absent here.
    // Drop the always-empty keys so they cannot read as "never reviewed".
    const { reviews, latestSecurityReviews, ...rest } = vendor;
    const result: Record<string, unknown> = {
      securityReviewsNote:
        "Drata's single-vendor GET carries no security-review data (upstream returns always-empty reviews/latestSecurityReviews; those keys are omitted here). Use list_vendor_security_reviews with this vendorId to check whether this vendor has security reviews.",
      ...rest,
    };
    // Defensive passthrough in case upstream ever starts populating them.
    if (Array.isArray(reviews) && reviews.length > 0) result.reviews = reviews;
    if (Array.isArray(latestSecurityReviews) && latestSecurityReviews.length > 0) {
      result.latestSecurityReviews = latestSecurityReviews;
    }
    return { isError: false, result };
  } catch (err) {
    return mapDrataError(err);
  }
}

/**
 * V1 endpoint (note the reversed segment order: /questionnaires/{qid}/vendor/{vid}).
 * This is the read that carries the vendor's actual questionnaire ANSWERS;
 * the V2 single-get surfaces send-status metadata.
 */
export async function getVendorQuestionnaireAnswers(
  vendorId: number,
  questionnaireId: number,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.getJson(
      `/public/questionnaires/${questionnaireId}/vendor/${vendorId}`,
    );
    return { isError: false, result };
  } catch (err) {
    return mapDrataError(err);
  }
}

export async function searchVendors(
  query: string,
): Promise<DrataClientResponse<unknown>> {
  try {
    if (typeof query !== "string" || query.trim().length === 0) {
      return {
        isError: true,
        error:
          "search_vendors query must be a non-empty string. Use list_vendors to enumerate all vendors.",
      };
    }
    const client = getDrataClient();
    const vendors = await client.getVendors();
    const lowerQuery = query.trim().toLowerCase();
    const matches = vendors
      .filter((v) => v.name.toLowerCase().includes(lowerQuery))
      .map((v) => {
        // archivedAt is the reliable archived signal; the upstream `status`
        // field is null for most active vendors, so it cannot be trusted.
        const archivedAt = (v.archivedAt as string | null | undefined) ?? null;
        return {
          id: v.id,
          name: v.name,
          archived: archivedAt != null,
          archivedAt,
          critical: v.critical,
          risk: v.risk,
          impactLevel: v.impactLevel,
          hasPii: v.hasPii,
          category: v.category,
          url: v.url,
          passwordPolicy: v.passwordPolicy,
          passwordMfaEnabled: v.passwordMfaEnabled,
        };
      });
    return {
      isError: false,
      result: {
        total: matches.length,
        archivedMatches: matches.filter((m) => m.archived).length,
        vendors: matches,
      },
    };
  } catch (err) {
    return mapDrataError(err);
  }
}
