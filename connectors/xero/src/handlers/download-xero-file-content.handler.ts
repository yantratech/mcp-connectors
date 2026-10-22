import { xeroClient } from "../clients/xero-client.js";
import { saveBinaryResponse } from "../helpers/save-binary-response.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export interface DownloadedFileContent {
  path: string;
  sizeBytes: number;
  fileName: string;
  mimeType: string;
  folderId: string | null;
}

export async function downloadXeroFileContent(
  fileId: string,
  outputPath: string,
  overwrite: boolean,
): Promise<XeroClientResponse<DownloadedFileContent>> {
  try {
    await xeroClient.authenticate();

    // Metadata first (name, mimeType, folder) — mirrors get_file — then the
    // binary content fetch.
    const fileResponse = await xeroClient.filesApi.getFile(
      xeroClient.tenantId,
      fileId,
    );
    const file = fileResponse.body;
    if (!file) {
      return {
        result: null,
        isError: true,
        error: "File not found.",
      };
    }

    const contentResponse = await xeroClient.filesApi.getFileContent(
      xeroClient.tenantId,
      fileId,
    );
    const saved = saveBinaryResponse(
      outputPath,
      contentResponse.body,
      overwrite,
    );

    return {
      result: {
        path: saved.path,
        sizeBytes: saved.sizeBytes,
        fileName: file.name ?? fileId,
        mimeType: file.mimeType ?? "application/octet-stream",
        folderId: file.folderId ?? null,
      },
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
