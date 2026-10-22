import { readFile } from "fs/promises";
import { getDrataClient } from "../clients/drata-client.js";
import { mapDrataError } from "../helpers/error-mapping.js";
import { validateUploadFilePath } from "./upload-validation.js";
import type { DrataClientResponse } from "../types/drata-client-response.js";

export async function uploadVendorDocument(
  vendorId: number,
  filePath: string,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    await validateUploadFilePath(filePath);
    const fileBuffer = await readFile(filePath);
    const fileName = filePath.split("/").pop() || "document.pdf";
    const result = await client.uploadVendorDocument(
      vendorId,
      new Uint8Array(fileBuffer),
      fileName,
    );
    return { isError: false, result };
  } catch (err) {
    return mapDrataError(err);
  }
}
