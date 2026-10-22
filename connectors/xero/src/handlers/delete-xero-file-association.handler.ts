import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function deleteXeroFileAssociation(
  fileId: string,
  objectId: string,
): Promise<XeroClientResponse<boolean>> {
  try {
    await xeroClient.authenticate();

    await xeroClient.filesApi.deleteFileAssociation(
      xeroClient.tenantId,
      fileId,
      objectId,
    );

    return {
      result: true,
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
