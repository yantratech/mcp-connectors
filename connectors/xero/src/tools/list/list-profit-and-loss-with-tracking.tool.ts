import { z } from "zod";
import { listXeroProfitAndLossWithTracking } from "../../handlers/list-xero-profit-and-loss-with-tracking.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { formatReportHeader } from "../../helpers/format-report-header.js";

const ListProfitAndLossWithTrackingTool = CreateXeroTool(
  "list_profit_and_loss_with_tracking",
  "Get a Profit & Loss report filtered by tracking categories in Xero. \
  This is useful for P&L by department, project, cost centre, or any other tracking dimension. \
  Use list_tracking_categories first to get the tracking category and option IDs. \
  Supports up to two tracking categories simultaneously. \
  The output header's Report line states the true reporting period — the Generated line is \
  only when Xero produced the report, not the reporting period. \
  Accrual basis by default; paymentsOnly=true switches to cash basis.",
  {
    fromDate: z
      .string()
      .optional()
      .describe("Start date in YYYY-MM-DD format."),
    toDate: z
      .string()
      .optional()
      .describe("End date in YYYY-MM-DD format."),
    periods: z
      .number()
      .optional()
      .describe("Number of periods to compare."),
    timeframe: z
      .enum(["MONTH", "QUARTER", "YEAR"])
      .optional()
      .describe("Timeframe for the report."),
    trackingCategoryID: z
      .string()
      .optional()
      .describe(
        "The ID of the first tracking category to filter by. Can be obtained from list_tracking_categories.",
      ),
    trackingOptionID: z
      .string()
      .optional()
      .describe(
        "The ID of the option within the first tracking category.",
      ),
    trackingCategoryID2: z
      .string()
      .optional()
      .describe(
        "The ID of the second tracking category to filter by (optional).",
      ),
    trackingOptionID2: z
      .string()
      .optional()
      .describe(
        "The ID of the option within the second tracking category (optional).",
      ),
    standardLayout: z
      .boolean()
      .optional()
      .describe("Use standard layout."),
    paymentsOnly: z
      .boolean()
      .optional()
      .describe(
        "Cash-basis toggle: when true the report includes only cash/payment transactions (cash basis). Omitted/false = accrual basis (Xero default).",
      ),
  },
  async (args) => {
    const response = await listXeroProfitAndLossWithTracking(
      args.fromDate,
      args.toDate,
      args.periods,
      args.timeframe,
      args.trackingCategoryID,
      args.trackingCategoryID2,
      args.trackingOptionID,
      args.trackingOptionID2,
      args.standardLayout,
      args.paymentsOnly,
    );

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting profit and loss report: ${response.error}`,
          },
        ],
      };
    }

    const report = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: formatReportHeader(report, {
            showBasis: true,
            paymentsOnly: args.paymentsOnly,
          }),
        },
        {
          type: "text" as const,
          text: JSON.stringify(report.rows ?? []),
        },
      ],
    };
  },
);

export default ListProfitAndLossWithTrackingTool;
