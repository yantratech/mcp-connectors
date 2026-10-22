import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { readUploadFile } from "../helpers/resolve-upload-path.js";

import type { FileObject } from "xero-node/dist/gen/model/files/fileObject.js";

export async function uploadXeroFile(
  filePath: string,
  fileName: string,
  mimeType: string,
  folderId?: string,
): Promise<XeroClientResponse<FileObject>> {
  try {
    // Enforce the local-file read policy (allow-list, no symlinks, regular
    // file, size cap) BEFORE authenticating, so a refused path fails fast
    // without a token exchange or any Xero call.
    const body = readUploadFile(filePath);

    await xeroClient.authenticate();

    let response;
    if (folderId) {
      response = await xeroClient.filesApi.uploadFileToFolder(
        xeroClient.tenantId,
        folderId,
        body,
        fileName,
        fileName,
        undefined, // idempotencyKey
        mimeType,
      );
    } else {
      response = await xeroClient.filesApi.uploadFile(
        xeroClient.tenantId,
        body,
        fileName,
        fileName,
        undefined, // idempotencyKey
        mimeType,
      );
    }

    if (!response.body) {
      return {
        result: null,
        isError: true,
        error: "Failed to upload file.",
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
