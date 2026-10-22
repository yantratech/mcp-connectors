import { z } from "zod";
import { checkVendorSecurityReviews } from "../../handlers/check-vendor-security-reviews.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const CheckVendorSecurityReviewsTool = CreateDrataTool(
  "list_vendor_security_review_statuses",
  "Check each vendor's security-review status the way the Drata app's 'Security review status' column does: a vendor counts as reviewed (UP_TO_DATE) only when it has at least one COMPLETED review; NOT_YET_STARTED/NOT_REQUIRED shells with decision PENDING count as NO_PAST_REVIEW. Per-vendor entries are compact (status, decision, counts, archived flag); pass fields[] for per-review detail. Reviews are discovered via Drata's per-vendor security-review list endpoint (reviewSources: api_list), supplemented for every vendor by the vendor payload (api_expand) and deprecated local-state IDs verified by GET-by-ID (persisted_get_by_id). Event-log and vendor-notes heuristics run only when a vendor's list call fails; their detections, and records without a status, surface as UNKNOWN because status cannot be seen.",
  {
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Opt-in per-vendor detail fields, omitted by default to keep the payload compact. Supported: "reviews" (per-review id/status/decision/title) and "latestCompletedReview" (latest COMPLETED review object). Counts and the latest completed decision are always present.',
      ),
  },
  async ({ fields }) => {
    const response = await checkVendorSecurityReviews({ fields });
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default CheckVendorSecurityReviewsTool;
