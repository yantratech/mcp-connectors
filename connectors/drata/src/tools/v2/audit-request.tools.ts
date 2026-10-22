import { z } from "zod";
import {
  getAudit,
  getAuditRequest,
  listAuditRequests,
  listAudits,
} from "../../handlers/v2-write.handler.js";
import type { DrataQueryParams } from "../../clients/drata-client.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

// Expand values are enumerated in Drata's spec: the audits list supports
// auditors/internalAuditors; the single-get additionally supports controls.
const AuditListExpand = z.enum(["auditors", "internalAuditors"]);
const AuditGetExpand = z.enum(["auditors", "internalAuditors", "controls"]);

const ListAuditsTool = CreateDrataTool(
  "list_audits",
  "List audits in a Drata workspace. Use this to discover the auditId required by list_audit_requests/get_audit_request. Fetches every page unless cursor/size is given.",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    cursor: z.string().optional().describe("Pagination cursor"),
    size: z.number().optional().describe("Page size"),
    sort: z.string().optional().describe("Sort field, e.g. createdAt or updatedAt"),
    sortDir: z.enum(["ASC", "DESC"]).optional().describe("Sort direction"),
    expand: z
      .array(AuditListExpand)
      .optional()
      .describe("Related fields to expand: auditors, internalAuditors"),
  },
  async ({ workspaceId, ...args }) => {
    const response = await listAudits(workspaceId, {
      cursor: args.cursor,
      size: args.size,
      sort: args.sort,
      sortDir: args.sortDir,
      expand: args.expand,
    });
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const GetAuditTool = CreateDrataTool(
  "get_audit",
  "Get a Drata audit by ID. Discover auditId via list_audits.",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    auditId: z.string().describe("Audit ID"),
    expand: z
      .array(AuditGetExpand)
      .optional()
      .describe("Related fields to expand: auditors, internalAuditors, controls"),
  },
  async ({ workspaceId, auditId, expand }) => {
    const response = await getAudit(
      workspaceId,
      auditId,
      expand ? { expand } : undefined,
    );
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

function auditParams(args: {
  cursor?: string;
  size?: number;
  sort?: string;
  sortDir?: "ASC" | "DESC";
  includeTotalCount?: boolean;
  expand?: string[];
  status?: string;
  statuses?: string[];
  userIds?: number[];
}): DrataQueryParams {
  const statuses = args.statuses ?? (args.status ? [args.status] : undefined);
  return {
    cursor: args.cursor,
    size: args.size,
    sort: args.sort,
    sortDir: args.sortDir,
    includeTotalCount: args.includeTotalCount,
    expand: args.expand,
    "status[]": statuses,
    "userIds[]": args.userIds?.map(String),
  };
}

const ListAuditRequestsTool = CreateDrataTool(
  "list_audit_requests",
  "List audit requests for a Drata audit. Discover auditId via list_audits.",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    auditId: z.string().describe("Audit ID"),
    cursor: z.string().optional().describe("Pagination cursor"),
    size: z.number().optional().describe("Page size"),
    sort: z.string().optional().describe("Sort field, e.g. createdAt or updatedAt"),
    sortDir: z.enum(["ASC", "DESC"]).optional().describe("Sort direction"),
    includeTotalCount: z.boolean().optional().describe("Ask Drata to include total count"),
    expand: z.array(z.string()).optional().describe("Related fields to expand"),
    statuses: z.array(z.string()).optional().describe("Filter by audit request statuses"),
    status: z
      .string()
      .optional()
      .describe("Deprecated alias for statuses; serialized as status[]."),
    userIds: z.array(z.number()).optional().describe("Filter by owner user IDs"),
  },
  async ({ workspaceId, auditId, ...args }) => {
    const response = await listAuditRequests(workspaceId, auditId, auditParams(args));
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const GetAuditRequestTool = CreateDrataTool(
  "get_audit_request",
  "Get a Drata audit request by ID. Discover auditId via list_audits.",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    auditId: z.string().describe("Audit ID"),
    requestId: z.number().describe("Audit request ID"),
    expand: z.array(z.string()).optional().describe("Related fields to expand"),
  },
  async ({ workspaceId, auditId, requestId, expand }) => {
    const response = await getAuditRequest(
      workspaceId,
      auditId,
      requestId,
      expand ? { expand } : undefined,
    );
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export const AuditRequestTools = [
  ListAuditsTool,
  GetAuditTool,
  ListAuditRequestsTool,
  GetAuditRequestTool,
];
