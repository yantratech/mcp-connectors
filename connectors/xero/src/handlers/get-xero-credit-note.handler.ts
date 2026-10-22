import { xeroClient } from "../clients/xero-client.js";
import { CreditNote } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function getXeroCreditNote(
  creditNoteId: string,
): Promise<XeroClientResponse<CreditNote>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getCreditNote(
      xeroClient.tenantId,
      creditNoteId,
      undefined, // unitdp
      getClientHeaders(),
    );

    const creditNote = response.body.creditNotes?.[0];

    if (!creditNote) {
      return {
        result: null,
        isError: true,
        error: "Credit note not found.",
      };
    }

    return {
      result: creditNote,
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
