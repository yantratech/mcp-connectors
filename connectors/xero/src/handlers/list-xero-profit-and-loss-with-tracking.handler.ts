import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { ReportWithRow } from "xero-node";

type TimeframeType = "MONTH" | "QUARTER" | "YEAR" | undefined;

export async function listXeroProfitAndLossWithTracking(
  fromDate?: string,
  toDate?: string,
  periods?: number,
  timeframe?: TimeframeType,
  trackingCategoryID?: string,
  trackingCategoryID2?: string,
  trackingOptionID?: string,
  trackingOptionID2?: string,
  standardLayout?: boolean,
  paymentsOnly?: boolean,
): Promise<XeroClientResponse<ReportWithRow>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getReportProfitAndLoss(
      xeroClient.tenantId,
      fromDate,
      toDate,
      periods,
      timeframe,
      trackingCategoryID,
      trackingCategoryID2,
      trackingOptionID,
      trackingOptionID2,
      standardLayout,
      paymentsOnly,
      getClientHeaders(),
    );

    const report = response.body.reports?.[0] ?? null;

    if (!report) {
      return {
        result: null,
        isError: true,
        error: "Failed to fetch profit and loss report.",
      };
    }

    return {
      result: report,
      isError: false,
      error: null,
    };
  } catch (error) {
    return {
      result: null,
      isError: true,
      error: formatError(error),
    };
  }
}
