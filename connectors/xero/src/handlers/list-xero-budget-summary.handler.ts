import { xeroClient } from "../clients/xero-client.js";
import { formatError } from "../helpers/format-error.js";
import { getClientHeaders } from "../helpers/get-client-headers.js";

import { ReportWithRow } from "xero-node";
import { XeroClientResponse } from "../types/tool-response.js";


async function getReportBudgetSummary(date?: string, periods?: number, timeframe?: number): Promise<ReportWithRow | null> {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getReportBudgetSummary(
        xeroClient.tenantId,
        date || undefined,
        periods || undefined,
        timeframe || undefined,
        getClientHeaders(),
    );
    return response.body.reports?.[0] ?? null;
}

export async function listXeroBudgetSummary(date?: string, periods?: number, timeframe?: number): Promise<XeroClientResponse<ReportWithRow>> {
    try {
        const budgetSummary = await getReportBudgetSummary(date, periods, timeframe);

        if (!budgetSummary) {
            return {
                result: null,
                isError: true,
                error: "Failed to fetch budget summary data from Xero.",
            };
        }

        return {
            result: budgetSummary,
            isError: false,
            error: null,
        };
    }
    catch (error) {
        return {
            result: null,
            isError: true,
            error: formatError(error),
        };
    }
};
