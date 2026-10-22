import { xeroClient } from "../clients/xero-client.js";
import { ManualJournal } from "xero-node";

import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function getXeroManualJournal(
  manualJournalId: string,
): Promise<XeroClientResponse<ManualJournal>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getManualJournal(
      xeroClient.tenantId,
      manualJournalId,
    );

    const manualJournal = response.body.manualJournals?.[0];

    if (!manualJournal) {
      return {
        result: null,
        isError: true,
        error: "Manual journal not found.",
      };
    }

    return {
      result: manualJournal,
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
