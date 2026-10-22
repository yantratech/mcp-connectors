import { z } from "zod";
import { getFrameworkRequirementReadinessRollup } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const GetFrameworkRequirementReadinessRollupTool = CreateDrataTool(
  "get_framework_requirement_readiness_rollup",
  "Roll up framework requirement readiness from the V2 controls list's reverse expand=requirements mapping (complete, unlike the requirement-side expand=controls which Drata caps at 10 inline controls), matching the Drata app: a requirement is OUT of scope when all its mapped controls are archived, and ready when all its live mapped controls are ready. `framework.*` totals cover the whole framework, are internally consistent with the per-requirement flags, and are cross-checked against Drata's own framework numbers (`framework.drataReported` / `matchesDrataReported`). `requirements[]` is one page of detailed per-requirement control rollups. Page via the returned cursor; `size` caps the detailed page. Read-only.",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var or first workspace."),
    frameworkId: z.number().optional().describe("Filter by framework ID."),
    cursor: z.string().optional().describe("Pagination cursor for the detailed requirements page."),
    size: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Detailed-requirements page size (caps returned requirements). Defaults to 25."),
    includeTotalCount: z.boolean().optional().describe("Ask Drata to include total count."),
    includeControlDetail: z
      .boolean()
      .optional()
      .describe(
        "Include full control objects per requirement (larger output; pair with a small size). Defaults to compact {code, isReady}.",
      ),
  },
  async ({ workspaceId, frameworkId, cursor, size, includeTotalCount, includeControlDetail }) => {
    const response = await getFrameworkRequirementReadinessRollup(
      workspaceId,
      { frameworkId, cursor, size, includeTotalCount },
      { includeControlDetail },
    );
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default GetFrameworkRequirementReadinessRollupTool;
