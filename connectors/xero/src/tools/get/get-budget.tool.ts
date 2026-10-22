import { z } from "zod";
import { getXeroBudget } from "../../handlers/get-xero-budget.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetBudgetTool = CreateXeroTool(
  "get_budget",
  "Get a specific budget by ID from Xero. Returns the full budget breakdown \
  including budget lines by account code and period amounts.",
  {
    budgetId: z
      .string()
      .describe(
        "The ID of the budget to retrieve. Can be obtained from list_budgets.",
      ),
    dateFrom: z
      .string()
      .optional()
      .describe("Start date for budget data (YYYY-MM-DD)."),
    dateTo: z
      .string()
      .optional()
      .describe("End date for budget data (YYYY-MM-DD)."),
  },
  async ({ budgetId, dateFrom, dateTo }) => {
    const response = await getXeroBudget(budgetId, dateTo, dateFrom);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting budget: ${response.error}`,
          },
        ],
      };
    }

    const b = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Budget details:",
            `Budget ID: ${b.budgetID}`,
            b.description ? `Description: ${b.description}` : null,
            b.type ? `Type: ${b.type}` : null,
            b.updatedDateUTC ? `Last Updated: ${b.updatedDateUTC}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
        ...(b.tracking
          ? [
              {
                type: "text" as const,
                text: `Tracking: ${b.tracking.map((t) => `${t.name}: ${t.option}`).join(", ")}`,
              },
            ]
          : []),
        ...(b.budgetLines?.map((line) => ({
          type: "text" as const,
          text: [
            `Account: ${line.accountCode} - ${line.accountID}`,
            line.budgetBalances && line.budgetBalances.length > 0
              ? line.budgetBalances
                  .map(
                    (bal) =>
                      `  Period ${bal.period}: Amount=${bal.amount}`,
                  )
                  .join("\n")
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
);

export default GetBudgetTool;
