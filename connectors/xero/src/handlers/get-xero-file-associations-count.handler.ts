import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function getXeroFileAssociationsCount(
  objectIds: string[],
): Promise<XeroClientResponse<Record<string, number>>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.filesApi.getAssociationsCount(
      xeroClient.tenantId,
      objectIds,
    );

    // The SDK types the body as a bare `object`; the Files API returns a map
    // of object ID -> association count.
    return {
      result: (response.body ?? {}) as Record<string, number>,
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
