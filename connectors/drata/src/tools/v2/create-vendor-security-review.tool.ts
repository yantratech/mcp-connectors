import { z } from "zod";
import { createVendorSecurityReview } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const CreateVendorSecurityReviewTool = CreateDrataTool(
  "create_vendor_security_review",
  "Create a security review for a vendor (V2). Enumerate a vendor's reviews afterwards with list_vendor_security_reviews. A review created with status NOT_YET_STARTED/NOT_REQUIRED is a scheduled shell the Drata app does not count as a past review — only COMPLETED counts.",
  {
    vendorId: z.number().describe("ID of the vendor"),
    reviewDeadlineAt: z.string().describe("Review deadline date (ISO 8601)"),
    securityReviewStatus: z
      .enum(["NOT_YET_STARTED", "IN_PROGRESS", "COMPLETED", "NOT_REQUIRED"])
      .describe("Status of the security review"),
    securityReviewType: z
      .enum(["SECURITY", "SOC_REPORT", "UPLOAD_REPORT"])
      .describe("Type of security review"),
    requesterUserId: z
      .number()
      .int()
      .positive()
      .max(1_000_000_000)
      .describe("ID of the user requesting the review"),
    // NOTE: The Drata V2 API silently ignores a `notes` field on security reviews.
    // Do not add it back — it will not be persisted. Store review notes in the
    // vendor's `notes` field via update_vendor instead.
  },
  async ({ vendorId, ...fields }) => {
    const response = await createVendorSecurityReview(vendorId, fields);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default CreateVendorSecurityReviewTool;
