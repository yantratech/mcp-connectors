import { z } from "zod";
import { listXeroBankSummary } from "../../handlers/list-xero-bank-summary.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { formatReportHeader } from "../../helpers/format-report-header.js";

const ListBankSummaryTool = CreateXeroTool(
  "list_bank_summary",
  "List the Bank Summary report from Xero. Shows a summary of all bank accounts including opening balance, cash received, cash spent, and closing balance.",
  {
    fromDate: z.string().optional().describe("Optional start date in YYYY-MM-DD format"),
    toDate: z.string().optional().describe("Optional end date in YYYY-MM-DD format"),
  },
  async (args) => {
    const response = await listXeroBankSummary(args?.fromDate, args?.toDate);

    if (response.error !== null) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing bank summary report: ${response.error}`,
          },
        ],
      };
    }

    const bankSummaryReport = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: formatReportHeader(bankSummaryReport),
        },
        {
          type: "text" as const,
          // Serialize only the report rows (not header/fields/attributes) and
          // drop the 2-space pretty-print so large reports stay within the
          // MCP token cap.
          text: JSON.stringify(bankSummaryReport?.rows ?? []),
        },
      ],
    };
  },
);

export default ListBankSummaryTool;
