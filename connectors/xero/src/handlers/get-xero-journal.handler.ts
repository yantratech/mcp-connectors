import { xeroClient } from "../clients/xero-client.js";
import { Journal } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function getXeroJournal(
  journalId: string,
): Promise<XeroClientResponse<Journal>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getJournal(
      xeroClient.tenantId,
      journalId,
      getClientHeaders(),
    );

    const journal = response.body.journals?.[0];

    if (!journal) {
      return {
        result: null,
        isError: true,
        error: "Journal not found.",
      };
    }

    return {
      result: journal,
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
