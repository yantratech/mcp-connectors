import { xeroClient } from "../clients/xero-client.js";
import { ManualJournal } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function voidXeroManualJournal(
  manualJournalId: string,
): Promise<XeroClientResponse<ManualJournal>> {
  try {
    await xeroClient.authenticate();

    // Fetch the existing journal to get its narration — Xero rejects
    // the update if narration is empty.
    const existing = await xeroClient.accountingApi.getManualJournal(
      xeroClient.tenantId,
      manualJournalId,
    );
    const existingJournal = existing.body.manualJournals?.[0];
    if (!existingJournal) {
      return {
        result: null,
        isError: true,
        error: `Manual journal ${manualJournalId} not found.`,
      };
    }

    const journal: ManualJournal = {
      narration: existingJournal.narration || "Voided",
      status: ManualJournal.StatusEnum.VOIDED,
    };

    const response = await xeroClient.accountingApi.updateManualJournal(
      xeroClient.tenantId,
      manualJournalId,
      { manualJournals: [journal] },
      undefined, // idempotencyKey
      getClientHeaders(),
    );

    const updated = response.body.manualJournals?.[0];

    if (!updated) {
      return {
        result: null,
        isError: true,
        error: "Failed to void manual journal.",
      };
    }

    return {
      result: updated,
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
