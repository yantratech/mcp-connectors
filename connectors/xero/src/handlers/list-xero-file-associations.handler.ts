import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

import type { Association } from "xero-node/dist/gen/model/files/association.js";

export async function listXeroFileAssociations(
  fileId: string,
): Promise<XeroClientResponse<Association[]>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.filesApi.getFileAssociations(
      xeroClient.tenantId,
      fileId,
    );

    return {
      result: response.body ?? [],
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
