import { z } from "zod";
import { listXeroReportBalanceSheet } from "../../handlers/list-xero-report-balance-sheet.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { formatReportHeader } from "../../helpers/format-report-header.js";
import { ListReportBalanceSheetParams } from "../../types/list-report-balance-sheet-params.js";

const ListReportBalanceSheetTool = CreateXeroTool(
  "list_report_balance_sheet",
  "List the Balance Sheet report from Xero. \
  The output header's Report line states the true as-at date (e.g. 'As at 31 March 2026') — \
  the Generated line is only when Xero produced the report, not the reporting period. \
  Accrual basis by default; paymentsOnly=true switches to cash basis.",
  {
    date: z.string().optional().describe("Optional as-at date in YYYY-MM-DD format"),
    periods: z.number().optional().describe("Optional number of periods to compare"),
    timeframe: z.enum(["MONTH", "QUARTER", "YEAR"]).optional().describe("Optional timeframe for the report (MONTH, QUARTER, YEAR)"),
    trackingOptionID1: z.string().optional().describe("Optional tracking option ID 1"),
    trackingOptionID2: z.string().optional().describe("Optional tracking option ID 2"),
    standardLayout: z.boolean().optional().describe("Optional flag to use standard layout"),
    paymentsOnly: z.boolean().optional().describe("Cash-basis toggle: when true the report includes only cash/payment transactions (cash basis). Omitted/false = accrual basis (Xero default)."),
  },
  async (args: ListReportBalanceSheetParams) => {
    const response = await listXeroReportBalanceSheet(args);

    // Check if the response contains an error
    if (response.error !== null) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing balance sheet report: ${response.error}`,
          },
        ],
      };
    }

    const balanceSheetReport = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: formatReportHeader(balanceSheetReport, {
            showBasis: true,
            paymentsOnly: args?.paymentsOnly,
          }),
        },
        {
          type: "text" as const,
          text: JSON.stringify(balanceSheetReport.rows ?? []),
        },
      ],
    };
  }
);

export default ListReportBalanceSheetTool;