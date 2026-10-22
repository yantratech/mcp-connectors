import { xeroClient } from "../clients/xero-client.js";
import { Journal } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function listXeroJournals(
  offset?: number,
  paymentsOnly?: boolean,
): Promise<XeroClientResponse<Journal[]>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getJournals(
      xeroClient.tenantId,
      undefined, // ifModifiedSince
      offset, // offset (journal number to start from)
      paymentsOnly, // paymentsOnly
      getClientHeaders(),
    );

    return {
      result: response.body.journals ?? [],
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
