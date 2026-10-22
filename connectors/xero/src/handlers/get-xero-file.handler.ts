import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

import type { FileObject } from "xero-node/dist/gen/model/files/fileObject.js";

export async function getXeroFile(
  fileId: string,
): Promise<XeroClientResponse<FileObject>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.filesApi.getFile(
      xeroClient.tenantId,
      fileId,
    );

    if (!response.body) {
      return {
        result: null,
        isError: true,
        error: "File not found.",
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
