import { xeroClient } from "../clients/xero-client.js";
import { formatError } from "../helpers/format-error.js";
import { getClientHeaders } from "../helpers/get-client-headers.js";

import { ReportWithRow } from "xero-node";
import { XeroClientResponse } from "../types/tool-response.js";


async function getReportExecutiveSummary(date?: string): Promise<ReportWithRow | null> {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getReportExecutiveSummary(
        xeroClient.tenantId,
        date || undefined,
        getClientHeaders(),
    );
    return response.body.reports?.[0] ?? null;
}

export async function listXeroExecutiveSummary(date?: string): Promise<XeroClientResponse<ReportWithRow>> {
    try {
        const executiveSummary = await getReportExecutiveSummary(date);

        if (!executiveSummary) {
            return {
                result: null,
                isError: true,
                error: "Failed to fetch executive summary data from Xero.",
            };
        }

        return {
            result: executiveSummary,
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
