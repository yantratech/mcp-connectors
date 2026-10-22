import { z } from "zod";
import { forecastMonthEnd } from "../../handlers/forecast-month-end.handler.js";
import { CreateYantraSpendTool } from "../../helpers/create-yantra-spend-tool.js";

const ForecastMonthEndTool = CreateYantraSpendTool(
  "forecast_month_end",
  "Per-source month-end forecast where the provider supports it. Supported: AWS (Cost Explorer GetCostForecast) and Azure (Cost Management Forecast). Returns { sources_skipped, warnings, forecasts }. Every source absent from `forecasts` is listed in the leading sources_skipped array with a reason ('skipped (no credentials)', 'unsupported', 'no forecast available...', 'api error (see warnings)') — a forecast covering only some sources is visibly partial, never silently complete-looking. The two providers' amounts mean DIFFERENT things (each entry's forecast_basis field states which): AWS is the projected total for the FULL current calendar month — month-to-date actuals plus projected remainder, period 1st-of-month to 1st-of-next (do NOT read it as 'remaining spend from today'); Azure is the projected REMAINING spend from today to month end, excluding actuals to date. Forecast values are CostLine shape with group_by_field='forecast', group_by_value='month_end'; period_start/period_end give the covered period. The provider-original `raw` blob is omitted by default; pass include_raw=true to attach it (AWS raw carries Total, ForecastResultsByTime with prediction-interval bounds, and SDK metadata).",
  {
    currency: z
      .enum(["USD", "GBP"])
      .default("USD")
      .describe("Output currency."),
    include_raw: z
      .boolean()
      .default(false)
      .describe(
        "When true, include the provider-original `raw` blob on every forecast entry. Default false.",
      ),
  },
  async ({ currency, include_raw }) => {
    const response = await forecastMonthEnd({ currency, include_raw });
    if (response.isError) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${response.error}` }],
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(response.result, null, 2),
        },
      ],
    };
  },
);

export default ForecastMonthEndTool;
