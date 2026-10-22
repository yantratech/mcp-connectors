import { z } from "zod";
import { listXeroTrialBalance } from "../../handlers/list-xero-trial-balance.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { formatReportHeader } from "../../helpers/format-report-header.js";

const ListTrialBalanceTool = CreateXeroTool(
  "list_trial_balance",
  "Lists the trial balance in Xero: debit and credit balances for each general-ledger account as at a date. \
  The output header's Report line states the true as-at date (e.g. 'As at 31 March 2026') — \
  the Generated line is only when Xero produced the report, not the reporting period. \
  Accrual basis by default; paymentsOnly=true switches to cash basis.",
  {
    date: z
      .string()
      .optional()
      .describe(
        "Optional as-at date for the balances in YYYY-MM-DD format. Defaults to today.",
      ),
    paymentsOnly: z
      .boolean()
      .optional()
      .describe(
        "Cash-basis toggle: when true the report includes only cash/payment transactions (cash basis). Omitted/false = accrual basis (Xero default).",
      ),
  },
  async (args) => {
    const response = await listXeroTrialBalance(args?.date, args?.paymentsOnly);
    if (response.error !== null) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing trial balance: ${response.error}`,
          },
        ],
      };
    }

   const trialBalanceReport = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: formatReportHeader(trialBalanceReport, {
            showBasis: true,
            paymentsOnly: args?.paymentsOnly,
          }),
        },
        {
          type: "text" as const,
          text: JSON.stringify(trialBalanceReport.rows ?? []),
        },
      ],
    };
  },
);

export default ListTrialBalanceTool;
