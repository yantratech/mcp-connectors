import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

import type { Folder } from "xero-node/dist/gen/model/files/folder.js";

export async function getXeroFolder(
  folderId: string,
): Promise<XeroClientResponse<Folder>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.filesApi.getFolder(
      xeroClient.tenantId,
      folderId,
    );

    if (!response.body) {
      return {
        result: null,
        isError: true,
        error: "Folder not found.",
      };
    }

    return {
      result: response.body,
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
