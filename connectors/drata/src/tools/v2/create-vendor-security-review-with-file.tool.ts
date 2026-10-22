import { z } from "zod";
import { createVendorSecurityReviewWithFile } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const CreateVendorSecurityReviewWithFileTool = CreateDrataTool(
  "create_vendor_security_review_with_file",
  "Create a security review for a vendor with a file attachment via multipart upload (V2). A review created with status NOT_YET_STARTED/NOT_REQUIRED is a scheduled shell the Drata app does not count as a past review — only COMPLETED counts.",
  {
    vendorId: z.number().describe("ID of the vendor"),
    fileBase64: z.string().describe("Base64-encoded file content"),
    fileName: z.string().describe("File name including extension"),
    title: z.string().describe("Title of the security review"),
    reviewDeadlineAt: z.string().describe("Review deadline date (ISO 8601)"),
    requestedAt: z.string().optional().describe("Date/time when the review was requested"),
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
    documentType: z
      .enum([
        "COMPLIANCE_REPORT",
        "COMPLIANCE_REPORT_REVIEW",
        "BRIDGE_LETTER",
        "UPLOADED_COMPLIANCE_REPORT_REVIEW",
        "QUESTIONNAIRE_ATTACHMENT",
        "SOC_DOCUMENT",
        "QUESTIONNAIRE_REPORT",
      ])
      .optional()
      .describe("Type of vendor document being uploaded"),
    // NOTE: The Drata V2 API silently ignores a `notes` field on security reviews.
    // Do not add it back — it will not be persisted. Store review notes in the
    // vendor's `notes` field via update_vendor instead.
  },
  async ({
    vendorId,
    fileBase64,
    fileName,
    title,
    reviewDeadlineAt,
    requestedAt,
    securityReviewStatus,
    securityReviewType,
    requesterUserId,
    documentType,
  }) => {
    const file = Uint8Array.from(atob(fileBase64), (c) => c.charCodeAt(0));
    const extraFields: Record<string, string> = {
      title,
      reviewDeadlineAt,
      securityReviewStatus,
      securityReviewType,
      requesterUserId: String(requesterUserId),
    };
    if (requestedAt) extraFields.requestedAt = requestedAt;
    if (documentType) extraFields.documentType = documentType;
    const response = await createVendorSecurityReviewWithFile(vendorId, file, fileName, extraFields);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default CreateVendorSecurityReviewWithFileTool;
