import { z } from "zod";
import { listXeroBudgets } from "../../handlers/list-xero-budgets.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListBudgetsTool = CreateXeroTool(
  "list_budgets",
  "List budget summaries in Xero. Returns all budgets with their names and periods. \
  Use get_budget with a specific budget ID to see the full breakdown by account.",
  {
    dateFrom: z
      .string()
      .optional()
      .describe("Filter budgets starting from this date (YYYY-MM-DD)."),
    dateTo: z
      .string()
      .optional()
      .describe("Filter budgets up to this date (YYYY-MM-DD)."),
  },
  async ({ dateFrom, dateTo }) => {
    const response = await listXeroBudgets(dateTo, dateFrom);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing budgets: ${response.error}`,
          },
        ],
      };
    }

    const budgets = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${budgets?.length || 0} budgets:`,
        },
        ...(budgets?.map((b) => ({
          type: "text" as const,
          text: [
            `Budget ID: ${b.budgetID}`,
            b.description ? `Description: ${b.description}` : null,
            b.type ? `Type: ${b.type}` : null,
            b.updatedDateUTC ? `Last Updated: ${b.updatedDateUTC}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
);

export default ListBudgetsTool;
