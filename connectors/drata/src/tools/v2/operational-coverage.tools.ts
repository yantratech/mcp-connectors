import { z } from "zod";
import {
  deleteCustomDataRecord,
  getEntityDocument,
  getRole,
  getUserDocument,
  getUserV2,
  listCustomDataRecords,
  listCustomDataSessions,
  listEntityDocuments,
  listRoles,
  listUserDocuments,
  listUsers,
  performCustomDataSessionAction,
  updateCustomDataRecord,
  upsertCustomDataRecords,
  upsertCustomDataRecordsSession,
} from "../../handlers/v2-write.handler.js";
import type { DrataQueryParams } from "../../clients/drata-client.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";
import { VendorSecurityReviewReadTools } from "./get-vendor-security-review.tool.js";
import { GetPolicyApprovalConfigurationTool } from "./get-policy.tool.js";

const IdSchema = z.union([z.number(), z.string()]);
const JsonBodySchema = z.record(z.string(), z.unknown());

function pageParams(args: {
  cursor?: string;
  size?: number;
  sort?: string;
  sortDir?: "ASC" | "DESC";
  includeTotalCount?: boolean;
  expand?: string[];
  type?: string;
  status?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
}): DrataQueryParams {
  return {
    cursor: args.cursor,
    size: args.size,
    sort: args.sort,
    sortDir: args.sortDir,
    includeTotalCount: args.includeTotalCount,
    expand: args.expand,
    type: args.type,
    status: args.status,
    name: args.name,
    firstName: args.firstName,
    lastName: args.lastName,
  };
}

// NOTE: the documents LIST endpoints reject `expand` upstream (HTTP 500 on any
// value). downloadUrl expansion is only available on the single-document GET,
// so `expand` is intentionally absent here.
const listDocumentShape = {
  entityId: IdSchema.describe("Entity ID"),
  cursor: z.string().optional().describe("Pagination cursor"),
  size: z.number().optional().describe("Page size"),
  includeTotalCount: z.boolean().optional().describe("Ask Drata to include total count"),
  type: z.string().optional().describe("Filter by document type"),
};

const DOWNLOAD_URL_NOTE =
  "Listing does not support downloadUrl/expand (Drata returns 500); use the matching get_…_document tool with expand:[\"downloadUrl\"] for a download link.";

const getDocumentShape = {
  entityId: IdSchema.describe("Entity ID"),
  documentId: z.number().describe("Document ID"),
  expand: z
    .array(z.string())
    .optional()
    .describe("Related fields to expand, e.g. downloadUrl"),
};

function makeListEntityDocumentsTool(
  name: string,
  description: string,
  entity: "devices" | "vendors",
) {
  return CreateDrataTool(name, description, listDocumentShape, async ({ entityId, ...args }) => {
    const response = await listEntityDocuments(entity, entityId, pageParams(args));
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  });
}

function makeGetEntityDocumentTool(
  name: string,
  description: string,
  entity: "devices" | "vendors",
) {
  return CreateDrataTool(
    name,
    description,
    getDocumentShape,
    async ({ entityId, documentId, expand }) => {
      const response = await getEntityDocument(
        entity,
        entityId,
        documentId,
        expand ? { expand } : undefined,
      );
      if (response.isError) {
        return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }],
      };
    },
  );
}

const ListUserDocumentsTool = CreateDrataTool(
  "list_user_documents_v2",
  `List user documents. ${DOWNLOAD_URL_NOTE}`,
  {
    userId: IdSchema.describe(
      "User-record ID (from list_users `id` or list_personnel `userId`; never the personnel `id` — the two id spaces overlap).",
    ),
    cursor: z.string().optional().describe("Pagination cursor"),
    size: z.number().optional().describe("Page size"),
    includeTotalCount: z.boolean().optional().describe("Ask Drata to include total count"),
    type: z.string().optional().describe("Filter by document type"),
  },
  async ({ userId, ...args }) => {
    const response = await listUserDocuments(userId, pageParams(args));
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const GetUserDocumentTool = CreateDrataTool(
  "get_user_document_v2",
  "Get a user document with optional downloadUrl expansion.",
  {
    userId: IdSchema.describe("User ID"),
    documentId: z.number().describe("Document ID"),
    expand: z
      .array(z.string())
      .optional()
      .describe("Related fields to expand, e.g. downloadUrl"),
  },
  async ({ userId, documentId, expand }) => {
    const response = await getUserDocument(userId, documentId, expand ? { expand } : undefined);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const ListDeviceDocumentsTool = makeListEntityDocumentsTool(
  "list_device_documents",
  `List device documents. ${DOWNLOAD_URL_NOTE}`,
  "devices",
);
const GetDeviceDocumentTool = makeGetEntityDocumentTool(
  "get_device_document",
  "Get a device document with optional downloadUrl expansion.",
  "devices",
);
const ListVendorDocumentsTool = CreateDrataTool(
  "list_vendor_documents_v2",
  `List documents for one vendor (vendorId required — there is no tenant-wide document listing). ${DOWNLOAD_URL_NOTE}`,
  {
    vendorId: IdSchema.describe("Vendor ID (required)"),
    cursor: z.string().optional().describe("Pagination cursor"),
    size: z.number().optional().describe("Page size"),
    includeTotalCount: z.boolean().optional().describe("Ask Drata to include total count"),
    type: z.string().optional().describe("Filter by document type"),
  },
  async ({ vendorId, ...args }) => {
    // Defensive runtime guard: schema-required, but direct handler calls can
    // still omit it.
    const resolvedVendorId = vendorId as typeof vendorId | undefined;
    if (resolvedVendorId === undefined) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Error: vendorId is required. list_vendor_documents_v2 lists documents for one vendor at /public/v2/vendors/{vendorId}/documents.",
          },
        ],
      };
    }
    const response = await listEntityDocuments(
      "vendors",
      resolvedVendorId,
      pageParams(args),
    );
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);
const GetVendorDocumentTool = makeGetEntityDocumentTool(
  "get_vendor_document_v2",
  "Get a vendor document with optional downloadUrl expansion.",
  "vendors",
);

const GetRiskDocumentTool = CreateDrataTool(
  "get_risk_document",
  "Get a risk document with optional downloadUrl expansion.",
  {
    riskRegisterId: z
      .number()
      .optional()
      .describe("Risk register ID. Defaults to DRATA_RISK_REGISTER_ID env var."),
    riskId: IdSchema.describe("Risk ID"),
    documentId: z.number().describe("Document ID"),
    expand: z
      .array(z.string())
      .optional()
      .describe("Related fields to expand, e.g. downloadUrl"),
  },
  async ({ riskRegisterId, riskId, documentId, expand }) => {
    const response = await getEntityDocument(
      "risk-registers",
      riskRegisterId,
      documentId,
      expand ? { expand } : undefined,
      riskId,
    );
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const ListRolesTool = CreateDrataTool(
  "list_roles",
  "List Drata roles for owner lookup and permission audits.",
  {
    cursor: z.string().optional().describe("Pagination cursor"),
    size: z.number().optional().describe("Page size"),
    sort: z.string().optional().describe("Sort field, e.g. createdAt or updatedAt"),
    sortDir: z.enum(["ASC", "DESC"]).optional().describe("Sort direction"),
    includeTotalCount: z.boolean().optional().describe("Ask Drata to include total count"),
    expand: z.array(z.string()).optional().describe("Related fields to expand"),
  },
  async (args) => {
    const response = await listRoles(pageParams(args));
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const GetRoleTool = CreateDrataTool(
  "get_role",
  "Get a Drata role by ID.",
  {
    roleId: IdSchema.describe("Role ID"),
    expand: z.array(z.string()).optional().describe("Related fields to expand"),
  },
  async ({ roleId, expand }) => {
    const response = await getRole(roleId, expand ? { expand } : undefined);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const ListUsersTool = CreateDrataTool(
  "list_users",
  "List Drata users for owner lookup and permission audits. Note: the total includes Drata 'Public API Key' pseudo-users (synthetic …@drata-public-api.com emails) — exclude them when counting humans for access reviews.",
  {
    roleId: IdSchema.optional().describe("Optional role ID to list users for a role"),
    cursor: z.string().optional().describe("Pagination cursor"),
    size: z.number().optional().describe("Page size"),
    sort: z.string().optional().describe("Sort field, e.g. createdAt or updatedAt"),
    sortDir: z.enum(["ASC", "DESC"]).optional().describe("Sort direction"),
    includeTotalCount: z.boolean().optional().describe("Ask Drata to include total count"),
    expand: z.array(z.string()).optional().describe("Related fields to expand"),
    firstName: z.string().optional().describe("Filter by user first name"),
    lastName: z.string().optional().describe("Filter by user last name"),
  },
  async ({ roleId, ...args }) => {
    const response = await listUsers(pageParams(args), roleId);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const GetUserTool = CreateDrataTool(
  "get_user",
  "Get a Drata user by ID. userId is the USER-record id (list_users `id`, or list_personnel's `userId` field) — NOT the personnel record id. The two integer id spaces overlap, so a personnel id passed here silently returns a DIFFERENT person.",
  {
    userId: IdSchema.describe(
      "User-record ID (from list_users `id` or list_personnel `userId`; never the personnel `id`).",
    ),
    expand: z.array(z.string()).optional().describe("Related fields to expand"),
  },
  async ({ userId, expand }) => {
    const response = await getUserV2(userId, expand ? { expand } : undefined);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const customDataBase = {
  connectionId: z.number().describe("Custom connection ID"),
  resourceId: z.number().describe("Custom connection resource ID"),
};

const ListCustomDataRecordsTool = CreateDrataTool(
  "list_custom_data_records",
  "List custom data records for a Drata custom connection resource.",
  {
    ...customDataBase,
    cursor: z.string().optional().describe("Pagination cursor"),
    size: z.number().optional().describe("Page size"),
    includeTotalCount: z.boolean().optional().describe("Ask Drata to include total count"),
  },
  async ({ connectionId, resourceId, ...args }) => {
    const response = await listCustomDataRecords(connectionId, resourceId, pageParams(args));
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const UpsertCustomDataRecordsTool = CreateDrataTool(
  "upsert_custom_data_records",
  "Upsert custom data records for a Drata custom connection resource.",
  {
    ...customDataBase,
    data: z.unknown().describe("Custom data record payload or array of payloads"),
  },
  async ({ connectionId, resourceId, data }) => {
    const response = await upsertCustomDataRecords(connectionId, resourceId, data);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const ListCustomDataSessionsTool = CreateDrataTool(
  "list_custom_data_records_sessions",
  "List custom data record sessions for a Drata custom connection resource.",
  {
    ...customDataBase,
    cursor: z.string().optional().describe("Pagination cursor"),
    size: z.number().optional().describe("Page size"),
    includeTotalCount: z.boolean().optional().describe("Ask Drata to include total count"),
  },
  async ({ connectionId, resourceId, ...args }) => {
    const response = await listCustomDataSessions(connectionId, resourceId, pageParams(args));
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const UpsertCustomDataRecordsSessionTool = CreateDrataTool(
  "upsert_custom_data_records_session",
  "Upsert custom data records into a Drata custom data session.",
  {
    ...customDataBase,
    sessionId: z.string().describe("Custom data session ID"),
    data: z.unknown().describe("Custom data session payload or array of payloads"),
  },
  async ({ connectionId, resourceId, sessionId, data }) => {
    const response = await upsertCustomDataRecordsSession(
      connectionId,
      resourceId,
      sessionId,
      data,
    );
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const PerformCustomDataSessionActionTool = CreateDrataTool(
  "perform_custom_data_session_action",
  "Perform an action on a Drata custom data session.",
  {
    ...customDataBase,
    sessionId: z.string().describe("Custom data session ID"),
    action: z.enum(["complete", "cancel"]).describe("Session action"),
  },
  async ({ connectionId, resourceId, sessionId, action }) => {
    const response = await performCustomDataSessionAction(
      connectionId,
      resourceId,
      sessionId,
      action,
    );
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const UpdateCustomDataRecordTool = CreateDrataTool(
  "update_custom_data_record",
  "Update one custom data record for a Drata custom connection resource.",
  {
    ...customDataBase,
    recordId: z.string().describe("Custom data record ID"),
    data: JsonBodySchema.describe("Custom data record update body"),
  },
  async ({ connectionId, resourceId, recordId, data }) => {
    const response = await updateCustomDataRecord(connectionId, resourceId, recordId, data);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const DeleteCustomDataRecordTool = CreateDrataTool(
  "delete_custom_data_record",
  "Delete one custom data record for a Drata custom connection resource.",
  {
    ...customDataBase,
    recordId: z.string().describe("Custom data record ID"),
  },
  async ({ connectionId, resourceId, recordId }) => {
    const response = await deleteCustomDataRecord(connectionId, resourceId, recordId);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export const OperationalCoverageTools = [
  ListUserDocumentsTool,
  GetUserDocumentTool,
  ListDeviceDocumentsTool,
  GetDeviceDocumentTool,
  ListVendorDocumentsTool,
  GetVendorDocumentTool,
  GetRiskDocumentTool,
  ListRolesTool,
  GetRoleTool,
  ListUsersTool,
  GetUserTool,
  ListCustomDataRecordsTool,
  UpsertCustomDataRecordsTool,
  ListCustomDataSessionsTool,
  UpsertCustomDataRecordsSessionTool,
  PerformCustomDataSessionActionTool,
  UpdateCustomDataRecordTool,
  DeleteCustomDataRecordTool,
  // Vendor security-review / questionnaire reads (see get-vendor-security-review.tool.ts).
  ...VendorSecurityReviewReadTools,
  // Policy governance read (see get-policy.tool.ts).
  GetPolicyApprovalConfigurationTool,
];
