import { z } from "zod";
import { listXeroBudgetSummary } from "../../handlers/list-xero-budget-summary.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { formatReportHeader } from "../../helpers/format-report-header.js";

const ListBudgetSummaryTool = CreateXeroTool(
  "list_budget_summary",
  "List the Budget Summary report from Xero. Shows a summary of budgets for the organisation.",
  {
    date: z.string().optional().describe("Optional date in YYYY-MM-DD format"),
    periods: z.number().optional().describe("Optional number of periods to compare"),
    timeframe: z.number().optional().describe("Optional timeframe for the report"),
  },
  async (args) => {
    const response = await listXeroBudgetSummary(args?.date, args?.periods, args?.timeframe);

    if (response.error !== null) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing budget summary report: ${response.error}`,
          },
        ],
      };
    }

    const budgetSummaryReport = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: formatReportHeader(budgetSummaryReport),
        },
        {
          type: "text" as const,
          // Serialize only the report rows (not header/fields/attributes) and
          // drop the 2-space pretty-print so large reports stay within the
          // MCP token cap.
          text: JSON.stringify(budgetSummaryReport?.rows ?? []),
        },
      ],
    };
  },
);

export default ListBudgetSummaryTool;
