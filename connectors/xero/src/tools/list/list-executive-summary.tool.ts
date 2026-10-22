import { z } from "zod";
import { listXeroExecutiveSummary } from "../../handlers/list-xero-executive-summary.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { formatReportHeader } from "../../helpers/format-report-header.js";

const ListExecutiveSummaryTool = CreateXeroTool(
  "list_executive_summary",
  "List the Executive Summary report from Xero. Shows key financial metrics including cash, debtors, creditors, and income/expense summaries.",
  {
    date: z.string().optional().describe("Optional date in YYYY-MM-DD format"),
  },
  async (args) => {
    const response = await listXeroExecutiveSummary(args?.date);

    if (response.error !== null) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing executive summary report: ${response.error}`,
          },
        ],
      };
    }

    const executiveSummaryReport = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: formatReportHeader(executiveSummaryReport),
        },
        {
          type: "text" as const,
          // Serialize only the report rows (not header/fields/attributes) and
          // drop the 2-space pretty-print so large reports stay within the
          // MCP token cap.
          text: JSON.stringify(executiveSummaryReport?.rows ?? []),
        },
      ],
    };
  },
);

export default ListExecutiveSummaryTool;
