import { z } from "zod";
import { checkControls } from "../../handlers/check-controls.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

// filter:"all" on a ~200-control tenant serializes past 100k chars when the
// controls array is pretty-printed field-by-field; keep the summary header
// readable but emit each control on one compact line so the full list stays
// inside MCP clients' truncation thresholds.
function serializeResult(result: unknown): string {
  const { controls, ...head } = result as Record<string, unknown>;
  if (!Array.isArray(controls)) return JSON.stringify(result, null, 2);
  const headJson = JSON.stringify(head, null, 2);
  const rows =
    controls.length === 0
      ? " []"
      : ` [\n${controls.map((c) => `    ${JSON.stringify(c)}`).join(",\n")}\n  ]`;
  return `${headJson.slice(0, -2)},\n  "controls":${rows}\n}`;
}

const CheckControlStatusTool = CreateDrataTool(
  "check_control_status",
  "Check the status of controls. Filter by readiness, monitoring, evidence, owner status, framework tag, or control code. Includes control IDs. `hasEvidence` (and the `no_evidence` filter) counts evidence of ANY kind — external uploads, evidence-library reports, mapped policies, and monitor tests — matching the Drata app's evidence view; each control is a slim status row by default, with the per-source breakdown available via fields (e.g. fields:[\"code\",\"evidence\"]). `isReady` is Drata's own readiness flag (computed from evidence, approvals, in-scope requirements, and monitor state; not settable). Archived controls are excluded by default, matching the app's in-scope counts. Requested codes[] that match nothing are reported under `unmatchedCodes`.",
  {
    filter: z
      .enum(["all", "not_ready", "no_evidence", "no_owner", "not_monitored", "ready"])
      .describe("Which controls to return"),
    frameworkFilter: z
      .string()
      .optional()
      .describe('Filter by framework tag, e.g. "SOC 2"'),
    codes: z
      .array(z.string())
      .optional()
      .describe('Filter by control code, e.g. ["DCF-26", "DCF-21"].'),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Return only the named fields per control, e.g. ["id", "code", "isReady"]. Available: id, code, name, isReady, isMonitored, hasEvidence, hasOwner, frameworkTags, archivedAt, evidence (per-source breakdown). When omitted, a slim default set (id, code, name, isReady, isMonitored, hasEvidence, hasOwner) is returned.',
      ),
    includeArchived: z
      .boolean()
      .optional()
      .describe(
        "Include archived controls (excluded by default to match the app's in-scope counts).",
      ),
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var or first workspace."),
  },
  async ({ filter, frameworkFilter, codes, fields, includeArchived, workspaceId }) => {
    const response = await checkControls(filter, frameworkFilter, {
      codes,
      fields,
      includeArchived,
      workspaceId,
    });

    if (response.isError) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${response.error}` }],
      };
    }

    return {
      content: [
        { type: "text" as const, text: serializeResult(response.result) },
      ],
    };
  },
);

export default CheckControlStatusTool;
