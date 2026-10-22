import { z } from "zod";
import { getXeroTaxRate } from "../../handlers/get-xero-tax-rate.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetTaxRateTool = CreateXeroTool(
  "get_tax_rate",
  "Get a specific tax rate from Xero by its TaxType code. \
  Single-lookup complement to list_tax_rates.",
  {
    taxType: z
      .string()
      .describe(
        'A valid Xero TaxType code, e.g. "OUTPUT2". Can be obtained from list_tax_rates.',
      ),
  },
  async ({ taxType }) => {
    const response = await getXeroTaxRate(taxType);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting tax rate: ${response.error}`,
          },
        ],
      };
    }

    const taxRate = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Tax rate details:",
            `Tax Rate: ${taxRate.name || "Unnamed"}`,
            `Tax Type: ${taxRate.taxType || "No tax type"}`,
            `Status: ${taxRate.status || "Unknown status"}`,
            `Display Tax Rate: ${taxRate.displayTaxRate || "0.0000"}%`,
            `Effective Rate: ${taxRate.effectiveRate || "0.0000"}%`,
            taxRate.taxComponents?.length
              ? `Tax Components:\n${taxRate.taxComponents
                  .map(
                    (comp) =>
                      `  - ${comp.name}: ${comp.rate}%${comp.isCompound ? " (Compound)" : ""}${comp.isNonRecoverable ? " (Non-recoverable)" : ""}`,
                  )
                  .join("\n")}`
              : null,
            `Can Apply To:${[
              taxRate.canApplyToAssets ? " Assets" : "",
              taxRate.canApplyToEquity ? " Equity" : "",
              taxRate.canApplyToExpenses ? " Expenses" : "",
              taxRate.canApplyToLiabilities ? " Liabilities" : "",
              taxRate.canApplyToRevenue ? " Revenue" : "",
            ].join("")}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default GetTaxRateTool;
