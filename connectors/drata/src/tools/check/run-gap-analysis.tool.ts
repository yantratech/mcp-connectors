import { z } from "zod";
import { runGapAnalysis } from "../../handlers/run-gap-analysis.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const RunGapAnalysisTool = CreateDrataTool(
  "run_gap_analysis",
  "Run a SOC2-style gap analysis over controls and monitors. Reports control readiness/evidence/ownership/monitoring gaps (in-scope controls only) and failing monitors bucketed by each monitor's own Drata priority, grouped by severity with next actions. Personnel/vendors/policies/connections are presence-checked only — their compliance is NOT assessed (use check_personnel_compliance / check_vendor_risk / list_devices_v2 for that).",
  {
    frameworkFilter: z
      .string()
      .optional()
      .describe(
        'Filter by framework tag, e.g. "SOC 2". Scopes CONTROLS only — monitor and inventory numbers stay tenant-wide. Omit for all.',
      ),
  },
  async ({ frameworkFilter }) => {
    const response = await runGapAnalysis(frameworkFilter);

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
  },
);

export default RunGapAnalysisTool;
