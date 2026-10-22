import { z } from "zod";
import {
  getVendorQuestionnaire,
  getVendorSecurityReview,
  listSecurityReviewActions,
  listSecurityReviewQuestionnaires,
  listVendorSecurityReviews,
} from "../../handlers/v2-write.handler.js";
import { getVendorQuestionnaireAnswers } from "../../handlers/vendor-read.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const SecurityReviewExpand = z.enum(["user", "requesterUser"]);

const ListVendorSecurityReviewsTool = CreateDrataTool(
  "list_vendor_security_reviews",
  "List security reviews for a vendor (V2). The primary way to discover securityReviewId values; fetches every page unless cursor/size is given. NOT_YET_STARTED/NOT_REQUIRED records are scheduled shells the Drata app does not count as past reviews — only COMPLETED counts. Nonexistent vendor IDs error with 404 (an empty list means the vendor really has no reviews).",
  {
    vendorId: z.number().describe("Vendor ID"),
    cursor: z.string().optional().describe("Pagination cursor"),
    size: z.number().optional().describe("Page size"),
    sort: z.string().optional().describe("Sort field, e.g. createdAt or updatedAt"),
    sortDir: z.enum(["ASC", "DESC"]).optional().describe("Sort direction"),
    includeTotalCount: z
      .boolean()
      .optional()
      .describe("Ask Drata to include total count"),
    statuses: z
      .array(z.enum(["NOT_YET_STARTED", "IN_PROGRESS", "COMPLETED", "NOT_REQUIRED"]))
      .optional()
      .describe("Filter by review statuses; serialized as status[]"),
    types: z
      .array(z.enum(["SECURITY", "SOC_REPORT", "UPLOAD_REPORT"]))
      .optional()
      .describe("Filter by review types; serialized as type[]"),
    decisions: z
      .array(
        z.enum(["PENDING", "APPROVED", "APPROVED_WITH_CONDITIONS", "REJECTED"]),
      )
      .optional()
      .describe("Filter by review decisions; serialized as decision[]"),
    expand: z
      .array(SecurityReviewExpand)
      .optional()
      .describe("Related fields to expand: user, requesterUser"),
  },
  async ({ vendorId, statuses, types, decisions, ...args }) => {
    const response = await listVendorSecurityReviews(vendorId, {
      cursor: args.cursor,
      size: args.size,
      sort: args.sort,
      sortDir: args.sortDir,
      includeTotalCount: args.includeTotalCount,
      expand: args.expand,
      "status[]": statuses,
      "type[]": types,
      "decision[]": decisions,
    });
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const GetVendorSecurityReviewTool = CreateDrataTool(
  "get_vendor_security_review",
  "Get a vendor security review by ID. Discover review IDs via list_vendor_security_reviews.",
  {
    vendorId: z.number().describe("Vendor ID"),
    securityReviewId: z.number().describe("Vendor security review ID"),
    expand: z
      .array(SecurityReviewExpand)
      .optional()
      .describe("Related fields to expand"),
  },
  async ({ vendorId, securityReviewId, expand }) => {
    const response = await getVendorSecurityReview(
      vendorId,
      securityReviewId,
      expand ? { expand } : undefined,
    );
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const ListSecurityReviewActionsTool = CreateDrataTool(
  "list_security_review_actions",
  "🧪 beta — may change. List the actions currently available on a vendor security review (e.g. finalize, reopen) given its present state. Works for all review types (SECURITY, SOC_REPORT, UPLOAD_REPORT).",
  {
    vendorId: z.number().describe("Vendor ID"),
    securityReviewId: z.number().describe("Vendor security review ID"),
  },
  async ({ vendorId, securityReviewId }) => {
    const response = await listSecurityReviewActions(vendorId, securityReviewId);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const ListSecurityReviewQuestionnairesTool = CreateDrataTool(
  "list_security_review_questionnaires",
  "🧪 beta — may change. List security questionnaires attached to a vendor security review. Archived/soft-deleted questionnaires are excluded by the API. Fetches every page unless cursor/size is given.",
  {
    vendorId: z.number().describe("Vendor ID"),
    securityReviewId: z.number().describe("Vendor security review ID"),
    cursor: z.string().optional().describe("Pagination cursor"),
    size: z.number().optional().describe("Page size"),
    sort: z.string().optional().describe("Sort field, e.g. createdAt or updatedAt"),
    sortDir: z.enum(["ASC", "DESC"]).optional().describe("Sort direction"),
    includeTotalCount: z
      .boolean()
      .optional()
      .describe("Ask Drata to include total count"),
  },
  async ({ vendorId, securityReviewId, ...args }) => {
    const response = await listSecurityReviewQuestionnaires(
      vendorId,
      securityReviewId,
      {
        cursor: args.cursor,
        size: args.size,
        sort: args.sort,
        sortDir: args.sortDir,
        includeTotalCount: args.includeTotalCount,
      },
    );
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const GetVendorQuestionnaireTool = CreateDrataTool(
  "get_vendor_questionnaire",
  "Get a vendor questionnaire by ID (V2). Surfaces send-status metadata; use get_vendor_questionnaire_answers for the vendor's submitted answers.",
  {
    vendorId: z.number().describe("Vendor ID"),
    questionnaireId: z.number().describe("Questionnaire ID"),
  },
  async ({ vendorId, questionnaireId }) => {
    const response = await getVendorQuestionnaire(vendorId, questionnaireId);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const GetVendorQuestionnaireAnswersTool = CreateDrataTool(
  "get_vendor_questionnaire_answers",
  "Get the answers a vendor submitted for a questionnaire (V1 endpoint). Discover questionnaireId via list_vendor_questionnaires.",
  {
    vendorId: z.number().describe("Vendor ID"),
    questionnaireId: z.number().describe("Questionnaire ID"),
  },
  async ({ vendorId, questionnaireId }) => {
    const response = await getVendorQuestionnaireAnswers(vendorId, questionnaireId);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

// Additional reads registered via OperationalCoverageTools
// (operational-coverage.tools.ts); the default export is wired in index.ts.
export const VendorSecurityReviewReadTools = [
  ListVendorSecurityReviewsTool,
  ListSecurityReviewActionsTool,
  ListSecurityReviewQuestionnairesTool,
  GetVendorQuestionnaireTool,
  GetVendorQuestionnaireAnswersTool,
];

export default GetVendorSecurityReviewTool;
