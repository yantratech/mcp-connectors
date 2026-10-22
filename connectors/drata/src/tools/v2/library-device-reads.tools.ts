import { z } from "zod";
import {
  getControl,
  getControlLibraryItem,
  getControlRequirementComparison,
  getDevice,
  getRiskLibraryItem,
  listConnectionDevices,
  listControlLibrary,
  listDeviceApps,
  listPersonnelDevices,
  listRiskLibrary,
} from "../../handlers/library-device-reads.handler.js";
import type { DrataQueryParams } from "../../clients/drata-client.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

// Expand values on GET /control-library/{id} are fully enumerated in the
// OpenAPI spec (ControlLibraryDetailExpandEnum) — pinned here verbatim.
const CONTROL_LIBRARY_DETAIL_EXPAND = [
  "testTemplates",
  "policyTemplates",
  "evidenceTemplates",
  "requirementTemplates",
  "controlsUsingTemplate",
] as const;

const WorkspaceIdSchema = z
  .number()
  .optional()
  .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var.");

const RiskRegisterIdSchema = z
  .number()
  .optional()
  .describe("Risk register ID. Defaults to DRATA_RISK_REGISTER_ID env var.");

const PaginationShape = {
  cursor: z.string().optional().describe("Pagination cursor from a previous response."),
  size: z.number().int().min(1).max(500).optional().describe("Page size."),
  sort: z.string().optional().describe("Sort field supported by Drata."),
  sortDir: z.enum(["ASC", "DESC"]).optional().describe("Sort direction."),
  includeTotalCount: z
    .boolean()
    .optional()
    .describe("Ask Drata to include total count on the first page."),
};

function pageParams(args: {
  cursor?: string;
  size?: number;
  sort?: string;
  sortDir?: "ASC" | "DESC";
  includeTotalCount?: boolean;
}): DrataQueryParams {
  return {
    cursor: args.cursor,
    size: args.size,
    sort: args.sort,
    sortDir: args.sortDir,
    includeTotalCount: args.includeTotalCount,
  };
}

type ToolResult = {
  isError?: boolean;
  content: { type: "text"; text: string }[];
};

function toToolResult(response: {
  isError: boolean;
  result?: unknown;
  error?: string;
}): ToolResult {
  if (response.isError) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: `Error: ${response.error}` }],
    };
  }
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(response.result, null, 2) },
    ],
  };
}

// ── Controls (reads) ────────────────────────────────────────────

const GetControlTool = CreateDrataTool(
  "get_control",
  "Get a single Drata control by ID (V2). Fills the V2 read gap (list_controls is V1-only); also the verification read after control scoping actions (check archivedAt). Discover controlId via list_controls. Note: the base record has NO status flags (isReady etc. require expand: [\"flags\"]), and V2 descriptions can contain a literal unresolved '%s' company placeholder (upstream quirk — V1 substitutes the company name). CAVEAT: flags.hasEvidence is Drata's narrow flag — only manually uploaded external evidence and evidence-library reports count; evidence from mapped policies and monitor tests does NOT. Use check_control_status for app-equivalent evidence coverage.",
  {
    workspaceId: WorkspaceIdSchema,
    controlId: z.number().describe("Control ID"),
    expand: z
      .array(z.string())
      .optional()
      .describe(
        "Related fields to expand: customFields, evidenceIds, flags, frameworkTags, owners, requirements, testIds, topics. Status flags (isReady/hasEvidence/…) appear ONLY with flags.",
      ),
    cursor: z
      .string()
      .optional()
      .describe("Advanced: cursor for paginating expanded sub-collections."),
    size: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe("Advanced: page size for expanded sub-collections."),
    sort: z
      .string()
      .optional()
      .describe("Advanced: sort field for expanded sub-collections."),
    sortDir: z
      .enum(["ASC", "DESC"])
      .optional()
      .describe("Advanced: sort direction for expanded sub-collections."),
  },
  async ({ workspaceId, controlId, expand, ...page }) => {
    const response = await getControl(workspaceId, controlId, {
      expand,
      ...pageParams(page),
    });
    if (response.isError) return toToolResult(response);
    // The flags expand echoes Drata's narrow V1-style hasEvidence (external
    // uploads + evidence-library reports only) — unlabeled, a false value on
    // a control whose evidence is mapped policies or monitor tests reads as
    // "no evidence", contradicting check_control_status on the same control.
    // Carry the same semantics caveat list_controls does — under the same
    // established semanticsNote key — inline next to the flag (key order puts
    // the note before hasEvidence).
    const result = response.result as Record<string, unknown> | null;
    const flags = result && typeof result === "object" ? result.flags : undefined;
    if (flags && typeof flags === "object" && "hasEvidence" in flags) {
      return toToolResult({
        isError: false,
        result: {
          ...result,
          flags: {
            semanticsNote:
              "hasEvidence is Drata's narrow flag — only manually uploaded external evidence and evidence-library reports count; evidence from mapped policies and monitor tests does NOT. Use check_control_status for app-equivalent evidence coverage.",
            ...(flags as Record<string, unknown>),
          },
        },
      });
    }
    return toToolResult(response);
  },
);

interface ComparisonRow {
  controlId?: unknown;
  alignedRequirements?: unknown;
  userMappedRequirements?: unknown;
  templateMappedRequirements?: unknown;
}

const GetControlRequirementComparisonTool = CreateDrataTool(
  "get_control_requirement_comparison",
  "Compare a control's tenant requirement mappings against Drata's global template mappings (V2). Use as the dry-run read before resetting control mappings to template defaults.",
  {
    workspaceId: WorkspaceIdSchema,
    controlIds: z
      .array(z.number())
      .min(1)
      .describe("Control IDs to compare (required)."),
  },
  async ({ workspaceId, controlIds }) => {
    const response = await getControlRequirementComparison(
      workspaceId,
      controlIds,
    );
    if (response.isError) return toToolResult(response);
    // Upstream returns a well-formed ALL-EMPTY comparison row for control
    // ids that don't exist — indistinguishable from "exists, unmapped,
    // matches template". Flag such rows so a typo'd id can't read as a
    // clean comparison.
    const result = response.result as { data?: ComparisonRow[] } | null;
    const rows = Array.isArray(result?.data) ? result!.data : [];
    const isAllEmpty = (r: ComparisonRow): boolean =>
      [
        r.alignedRequirements,
        r.userMappedRequirements,
        r.templateMappedRequirements,
      ].every((a) => Array.isArray(a) && a.length === 0);
    const suspect = rows.filter(isAllEmpty).map((r) => r.controlId);
    if (suspect.length > 0) {
      return toToolResult({
        isError: false,
        result: {
          note: `Control id(s) [${suspect.join(", ")}] returned no mappings in ANY category — Drata returns this same empty shape for NONEXISTENT control ids, so verify them with get_control before treating them as unmapped controls.`,
          ...(result as Record<string, unknown>),
        },
      });
    }
    return toToolResult(response);
  },
);

// ── Control library (reads) ─────────────────────────────────────

const ListControlLibraryTool = CreateDrataTool(
  "list_control_library",
  "Browse Drata's prebuilt control template library (V2, not workspace-scoped). Requires the Custom Frameworks feature (💎) — contact your Drata CSM if gated. Without cursor/size, fetches all pages.",
  {
    ...PaginationShape,
    search: z.string().optional().describe("Free-text search over templates."),
    codes: z
      .array(z.string())
      .optional()
      .describe("Filter by control template codes (serialized as codes[])."),
    ids: z
      .array(z.number())
      .optional()
      .describe("Filter to specific template IDs (serialized as ids[])."),
    excludeIds: z
      .array(z.number())
      .optional()
      .describe("Exclude template IDs (serialized as excludeIds[])."),
    domain: z.string().optional().describe("Filter by control domain."),
    category: z.string().optional().describe("Filter by control category."),
    frameworkTag: z
      .string()
      .optional()
      .describe("Filter by framework tag, e.g. SOC 2."),
    hasTests: z
      .boolean()
      .optional()
      .describe("Only templates with mapped monitoring tests."),
    hasPolicies: z
      .boolean()
      .optional()
      .describe("Only templates with mapped policies."),
    hasEvidence: z
      .boolean()
      .optional()
      .describe("Only templates with mapped evidence."),
    hasRisks: z.boolean().optional().describe("Only templates with mapped risks."),
    fields: z
      .array(z.string())
      .optional()
      .describe('Return only selected fields, e.g. ["id", "code", "name"].'),
  },
  async ({ codes, ids, excludeIds, fields, ...args }) => {
    const params: DrataQueryParams = {
      ...pageParams(args),
      search: args.search,
      "codes[]": codes,
      "ids[]": ids?.map(String),
      "excludeIds[]": excludeIds?.map(String),
      domain: args.domain,
      category: args.category,
      frameworkTag: args.frameworkTag,
      hasTests: args.hasTests,
      hasPolicies: args.hasPolicies,
      hasEvidence: args.hasEvidence,
      hasRisks: args.hasRisks,
    };
    const response = await listControlLibrary(params, { fields });
    return toToolResult(response);
  },
);

const GetControlLibraryItemTool = CreateDrataTool(
  "get_control_library_item",
  "Get a single control template from Drata's control library (V2). Requires the Custom Frameworks feature (💎) — contact your Drata CSM if gated.",
  {
    templateId: z.number().describe("Control library template ID"),
    expand: z
      .array(z.enum(CONTROL_LIBRARY_DETAIL_EXPAND))
      .optional()
      .describe(
        "Expand-gated relations: testTemplates, policyTemplates, evidenceTemplates, requirementTemplates, controlsUsingTemplate.",
      ),
  },
  async ({ templateId, expand }) => {
    const response = await getControlLibraryItem(
      templateId,
      expand ? { expand } : undefined,
    );
    return toToolResult(response);
  },
);

// ── Risk library (reads) ────────────────────────────────────────

const ListRiskLibraryTool = CreateDrataTool(
  "list_risk_library",
  "Browse Drata's risk library for a risk register (V2). Requires the Risk Management Pro feature (💎) — contact your Drata CSM if gated. Library risk IDs are strings. Without cursor/size, fetches all pages.",
  {
    riskRegisterId: RiskRegisterIdSchema,
    ...PaginationShape,
    riskId: z
      .string()
      .optional()
      .describe("Filter by library risk ID (string in this API family)."),
    title: z.string().optional().describe("Filter by risk title."),
    description: z.string().optional().describe("Filter by risk description."),
    expand: z.array(z.string()).optional().describe("Related fields to expand."),
    fields: z
      .array(z.string())
      .optional()
      .describe('Return only selected fields, e.g. ["id", "title"].'),
  },
  async ({ riskRegisterId, riskId, title, description, expand, fields, ...page }) => {
    const params: DrataQueryParams = {
      ...pageParams(page),
      riskId,
      title,
      description,
      expand,
    };
    const response = await listRiskLibrary(riskRegisterId, params, { fields });
    return toToolResult(response);
  },
);

const GetRiskLibraryItemTool = CreateDrataTool(
  "get_risk_library_item",
  "Get a single risk from Drata's risk library (V2). Requires the Risk Management Pro feature (💎) — contact your Drata CSM if gated.",
  {
    riskRegisterId: RiskRegisterIdSchema,
    riskLibraryId: z
      .string()
      .describe("Risk library item ID (string, e.g. from list_risk_library)."),
    expand: z.array(z.string()).optional().describe("Related fields to expand."),
  },
  async ({ riskRegisterId, riskLibraryId, expand }) => {
    const response = await getRiskLibraryItem(
      riskRegisterId,
      riskLibraryId,
      expand ? { expand } : undefined,
    );
    return toToolResult(response);
  },
);

// ── Device drill-down (reads) ───────────────────────────────────

const GetDeviceTool = CreateDrataTool(
  "get_device",
  "Get a single Drata device by ID (V2). Discover deviceId via list_devices_v2 or list_personnel_devices.",
  {
    deviceId: z.number().describe("Device ID"),
    expand: z
      .array(z.string())
      .optional()
      .describe("Related fields to expand. Known values: personnel, connection, apps."),
  },
  async ({ deviceId, expand }) => {
    const response = await getDevice(deviceId, expand ? { expand } : undefined);
    return toToolResult(response);
  },
);

const ListDeviceAppsTool = CreateDrataTool(
  "list_device_apps",
  'List applications installed on a Drata device (V2). App records have exactly two fields: id and installedApp (one pre-concatenated string like "microsoft outlook version 16.111.2" — there are NO separate name/version fields). App lists can run to hundreds of rows — use fields ["installedApp"] to keep responses lean. Without cursor/size, fetches all pages.',
  {
    deviceId: z.number().describe("Device ID"),
    ...PaginationShape,
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Return only selected fields, e.g. ["installedApp"]. App records contain only "id" and "installedApp" — projecting nonexistent fields (like "name" or "version") returns empty objects.',
      ),
  },
  async ({ deviceId, fields, ...page }) => {
    const response = await listDeviceApps(deviceId, pageParams(page), {
      fields,
    });
    return toToolResult(response);
  },
);

const ListPersonnelDevicesTool = CreateDrataTool(
  "list_personnel_devices",
  "List devices associated with a personnel record (V2). Provide exactly one of personnelId or lookupEmail (resolved via the V1 personnel directory). Without cursor/size, fetches all pages.",
  {
    personnelId: z
      .number()
      .optional()
      .describe("Personnel record ID (not userId)."),
    lookupEmail: z
      .string()
      .optional()
      .describe("Resolve the personnel record by work email instead of ID."),
    ...PaginationShape,
    externalId: z.string().optional().describe("Filter by external device ID."),
    macAddress: z.string().optional().describe("Filter by MAC address."),
    serialNumber: z.string().optional().describe("Filter by serial number."),
    sourceType: z.string().optional().describe("Filter by device source type."),
    expand: z
      .array(z.string())
      .optional()
      .describe("Related fields to expand. Known values: personnel, connection."),
  },
  async ({
    personnelId,
    lookupEmail,
    externalId,
    macAddress,
    serialNumber,
    sourceType,
    expand,
    ...page
  }) => {
    const response = await listPersonnelDevices(
      { personnelId, lookupEmail },
      {
        ...pageParams(page),
        externalId,
        macAddress,
        serialNumber,
        sourceType,
        expand,
      },
    );
    return toToolResult(response);
  },
);

const ListConnectionDevicesTool = CreateDrataTool(
  "list_connection_devices",
  "List devices reported by a Drata connection (V2). 🧪 beta — may change; the official docs mark this endpoint experimental. Without cursor/size, fetches all pages.",
  {
    connectionId: z.number().describe("Connection ID"),
    ...PaginationShape,
    externalId: z.string().optional().describe("Filter by external device ID."),
    macAddress: z.string().optional().describe("Filter by MAC address."),
    serialNumber: z.string().optional().describe("Filter by serial number."),
    personnelId: z
      .number()
      .optional()
      .describe("Filter to devices owned by a personnel record ID."),
    expand: z
      .array(z.string())
      .optional()
      .describe("Related fields to expand. Known values: personnel, connection."),
  },
  async ({
    connectionId,
    externalId,
    macAddress,
    serialNumber,
    personnelId,
    expand,
    ...page
  }) => {
    const response = await listConnectionDevices(connectionId, {
      ...pageParams(page),
      externalId,
      macAddress,
      serialNumber,
      personnelId,
      expand,
    });
    return toToolResult(response);
  },
);

export const LibraryDeviceReadTools = [
  GetControlTool,
  GetControlRequirementComparisonTool,
  ListControlLibraryTool,
  GetControlLibraryItemTool,
  ListRiskLibraryTool,
  GetRiskLibraryItemTool,
  GetDeviceTool,
  ListDeviceAppsTool,
  ListPersonnelDevicesTool,
  ListConnectionDevicesTool,
];
