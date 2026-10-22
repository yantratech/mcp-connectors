import { xeroClient } from "../clients/xero-client.js";
import { formatError } from "../helpers/format-error.js";
import { getClientHeaders } from "../helpers/get-client-headers.js";

import { ReportWithRow } from "xero-node";
import { XeroClientResponse } from "../types/tool-response.js";


async function getReportBankSummary(fromDate?: string, toDate?: string): Promise<ReportWithRow | null> {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getReportBankSummary(
        xeroClient.tenantId,
        fromDate || undefined,
        toDate || undefined,
        getClientHeaders(),
    );
    return response.body.reports?.[0] ?? null;
}

export async function listXeroBankSummary(fromDate?: string, toDate?: string): Promise<XeroClientResponse<ReportWithRow>> {
    try {
        const bankSummary = await getReportBankSummary(fromDate, toDate);

        if (!bankSummary) {
            return {
                result: null,
                isError: true,
                error: "Failed to fetch bank summary data from Xero.",
            };
        }

        return {
            result: bankSummary,
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
