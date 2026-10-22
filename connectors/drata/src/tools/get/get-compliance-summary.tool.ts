import { getComplianceSummary } from "../../handlers/get-compliance-summary.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const GetComplianceSummaryTool = CreateDrataTool(
  "get_compliance_summary",
  "Get a high-level compliance posture summary — ready/not-ready controls, passing/failing monitors (failingMonitors includes errored checks, broken out as errorMonitors), personnel, vendors, policies, assets, devices, connections.",
  {},
  async () => {
    const response = await getComplianceSummary();

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

export default GetComplianceSummaryTool;
