import { z } from "zod";
import {
  createRisk,
  getRisk,
  getRiskInsights,
  listRisks,
  updateRisk,
} from "../../handlers/v2-write.handler.js";
import type { DrataQueryParams } from "../../clients/drata-client.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const RiskIdSchema = z.union([z.number(), z.string()]);
const JsonBodySchema = z.record(z.string(), z.unknown());

// Drata risk filters use fixed enums. Pinning them turns a silent empty
// result (Drata filters quietly on an unrecognized value) into either a
// schema-time rejection or a visible list of valid options. The values were
// checked against the API's own enum validation.
const RISK_STATUSES = ["ACTIVE", "ARCHIVED", "CLOSED"] as const;
const RISK_TREATMENT_PLANS = [
  "UNTREATED",
  "ACCEPT",
  "TRANSFER",
  "AVOID",
  "MITIGATE",
] as const;

function riskParams(args: {
  cursor?: string;
  size?: number;
  includeTotalCount?: boolean;
  expand?: string[];
  title?: string;
  status?: (typeof RISK_STATUSES)[number];
  treatmentPlan?: (typeof RISK_TREATMENT_PLANS)[number];
  minScore?: number;
  maxScore?: number;
  vendorId?: number;
}): DrataQueryParams {
  return {
    cursor: args.cursor,
    size: args.size,
    includeTotalCount: args.includeTotalCount,
    expand: args.expand,
    title: args.title,
    status: args.status,
    treatmentPlan: args.treatmentPlan,
    minScore: args.minScore,
    maxScore: args.maxScore,
    vendorId: args.vendorId,
  };
}

// The Drata app hides ARCHIVED risks from the register, but the raw V2 list
// folds them into rows AND totalCount — so the raw total overstates the
// register (archived rows inflate it). Mirror list_controls: exclude
// archived rows unless asked, and report archivedRisksExcluded BEFORE the
// array so the default total matches the app.
async function excludeArchivedRisks(
  riskRegisterId: number | undefined,
  result: Record<string, unknown>,
  args: Parameters<typeof riskParams>[0],
): Promise<Record<string, unknown>> {
  const rows = Array.isArray(result.risks)
    ? (result.risks as Record<string, unknown>[])
    : [];
  const kept = rows.filter((r) => r?.status !== "ARCHIVED");
  const nextCursor =
    (result.pagination as { cursor?: unknown } | undefined)?.cursor ?? null;
  let total: number | null;
  let archivedRisksExcluded: number | null;
  if (nextCursor === null && !args.cursor) {
    // This response IS the full filtered result — counts are exact locally.
    total = kept.length;
    archivedRisksExcluded = rows.length - kept.length;
  } else {
    // Paginated: one page can't see the archived universe, and upstream
    // totalCount includes archived rows. Ask Drata for the archived count
    // (same non-status filters) so the corrected total stays accurate.
    const archived = await listRisks(riskRegisterId, {
      ...riskParams({ ...args, cursor: undefined, expand: undefined }),
      status: "ARCHIVED",
      size: 1,
      includeTotalCount: true,
    });
    const archivedTotal = archived.isError
      ? null
      : (archived.result as { total?: unknown } | null)?.total;
    archivedRisksExcluded =
      typeof archivedTotal === "number" ? archivedTotal : null;
    const upstreamTotal = typeof result.total === "number" ? result.total : null;
    total =
      upstreamTotal !== null && archivedRisksExcluded !== null
        ? upstreamTotal - archivedRisksExcluded
        : null;
  }
  return {
    total,
    returned: kept.length,
    archivedRisksExcluded,
    pagination: result.pagination ?? { cursor: null },
    risks: kept,
  };
}

const ListRisksTool = CreateDrataTool(
  "list_risks",
  "List risks in a risk register with Drata V2 filters and cursor pagination. Archived risks are excluded by default (the Drata app hides them from the register); archivedRisksExcluded reports how many were held back. Pass includeArchived: true — or an explicit status filter — to see them.",
  {
    riskRegisterId: z
      .number()
      .optional()
      .describe("Risk register ID. Defaults to DRATA_RISK_REGISTER_ID env var."),
    cursor: z.string().optional().describe("Pagination cursor"),
    size: z.number().optional().describe("Page size"),
    includeTotalCount: z.boolean().optional().describe("Ask Drata to include total count"),
    expand: z
      .array(z.string())
      .optional()
      .describe("Related fields to expand. Known values: owner, controls, vendor."),
    title: z.string().optional().describe("Filter by risk title"),
    status: z
      .enum(RISK_STATUSES)
      .optional()
      .describe("Filter by risk status: ACTIVE, ARCHIVED, or CLOSED."),
    treatmentPlan: z
      .enum(RISK_TREATMENT_PLANS)
      .optional()
      .describe(
        "Filter by treatment plan: UNTREATED, ACCEPT, TRANSFER, AVOID, or MITIGATE.",
      ),
    minScore: z.number().optional().describe("Minimum risk score"),
    maxScore: z.number().optional().describe("Maximum risk score"),
    vendorId: z.number().optional().describe("Filter by associated vendor ID"),
    includeArchived: z
      .boolean()
      .optional()
      .describe(
        'Include ARCHIVED risks; their rows carry status: "ARCHIVED". Default false (matching the Drata app\'s register view).',
      ),
  },
  async ({ riskRegisterId, includeArchived, ...args }) => {
    const response = await listRisks(riskRegisterId, riskParams(args));
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    const raw = response.result as Record<string, unknown>;
    const result =
      includeArchived || args.status
        ? {
            // Nothing held back on this path — keep the field (as 0) so the
            // response shape matches the default listing, mirroring the
            // excludedArchived/archivedControlsExcluded siblings.
            total: raw.total,
            returned: raw.returned,
            archivedRisksExcluded: 0,
            pagination: raw.pagination,
            risks: raw.risks,
          }
        : await excludeArchivedRisks(riskRegisterId, raw, args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
);

const GetRiskTool = CreateDrataTool(
  "get_risk",
  "Get a risk by ID from a risk register.",
  {
    riskRegisterId: z
      .number()
      .optional()
      .describe("Risk register ID. Defaults to DRATA_RISK_REGISTER_ID env var."),
    riskId: RiskIdSchema.describe("Risk ID"),
    expand: z
      .array(z.string())
      .optional()
      .describe("Related fields to expand. Known values: owner, controls, vendor."),
  },
  async ({ riskRegisterId, riskId, expand }) => {
    const response = await getRisk(riskRegisterId, riskId, expand ? { expand } : undefined);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const CreateRiskTool = CreateDrataTool(
  "create_risk",
  "Create a risk in a risk register. Body is passed through to Drata V2. Drata plans that do not include the risk module return 402 for risk-module writes; the error mapper surfaces that as a plan-gated hint.",
  {
    riskRegisterId: z
      .number()
      .optional()
      .describe("Risk register ID. Defaults to DRATA_RISK_REGISTER_ID env var."),
    body: JsonBodySchema.describe("Risk create request body"),
  },
  async ({ riskRegisterId, body }) => {
    const response = await createRisk(riskRegisterId, body);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const UpdateRiskTool = CreateDrataTool(
  "update_risk",
  "Update a risk in a risk register. Body is passed through to Drata V2. Drata plans that do not include the risk module return 402 for risk-module writes; the error mapper surfaces that as a plan-gated hint.",
  {
    riskRegisterId: z
      .number()
      .optional()
      .describe("Risk register ID. Defaults to DRATA_RISK_REGISTER_ID env var."),
    riskId: RiskIdSchema.describe("Risk ID"),
    body: JsonBodySchema.describe("Risk update request body"),
  },
  async ({ riskRegisterId, riskId, body }) => {
    const response = await updateRisk(riskRegisterId, riskId, body);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const GetRiskInsightsTool = CreateDrataTool(
  "get_risk_insights",
  "Get risk insights for a risk register. Requires the Risk Management Pro feature (💎) — plans without it get HTTP 402; use list_risks / get_risk / list_risk_notes for base-tier risk reads.",
  {
    riskRegisterId: z
      .number()
      .optional()
      .describe("Risk register ID. Defaults to DRATA_RISK_REGISTER_ID env var."),
    expand: z
      .array(z.string())
      .optional()
      .describe("Related fields to expand. Known values: owner, controls, vendor."),
  },
  async ({ riskRegisterId, expand }) => {
    const response = await getRiskInsights(riskRegisterId, expand ? { expand } : undefined);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export const RiskOperationsTools = [
  ListRisksTool,
  GetRiskTool,
  CreateRiskTool,
  UpdateRiskTool,
  GetRiskInsightsTool,
];
