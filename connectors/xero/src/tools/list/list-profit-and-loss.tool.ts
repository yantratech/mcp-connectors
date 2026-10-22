import { z } from "zod";
import { listXeroProfitAndLoss } from "../../handlers/list-xero-profit-and-loss.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { formatReportHeader } from "../../helpers/format-report-header.js";

const ListProfitAndLossTool = CreateXeroTool(
  "list_profit_and_loss",
  "Lists profit and loss report in Xero. This provides a summary of revenue, expenses, and profit or loss over a specified period of time. \
  The output header's Report line states the true reporting period (e.g. '1 January 2026 to 31 March 2026') — \
  the Generated line is only when Xero produced the report, not the reporting period. \
  Accrual basis by default; paymentsOnly=true switches to cash basis.",
  {
    fromDate: z.string().optional().describe("Optional start date in YYYY-MM-DD format"),
    toDate: z.string().optional().describe("Optional end date in YYYY-MM-DD format"),
    periods: z.number().optional().describe("Optional number of periods to compare"),
    timeframe: z.enum(["MONTH", "QUARTER", "YEAR"]).optional().describe("Optional timeframe for the report (MONTH, QUARTER, YEAR)"),
    standardLayout: z.boolean().optional().describe("Optional flag to use standard layout"),
    paymentsOnly: z.boolean().optional().describe("Cash-basis toggle: when true the report includes only cash/payment transactions (cash basis). Omitted/false = accrual basis (Xero default)."),
  },
  async (args) => {
    const response = await listXeroProfitAndLoss(
      args?.fromDate,
      args?.toDate,
      args?.periods,
      args?.timeframe,
      args?.standardLayout,
      args?.paymentsOnly,
    );

    if (response.error !== null) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing profit and loss report: ${response.error}`,
          },
        ],
      };
    }

    const profitAndLossReport = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: formatReportHeader(profitAndLossReport, {
            showBasis: true,
            paymentsOnly: args?.paymentsOnly,
          }),
        },
        {
          type: "text" as const,
          text: JSON.stringify(profitAndLossReport.rows ?? []),
        },
      ],
    };
  },
);

export default ListProfitAndLossTool; 