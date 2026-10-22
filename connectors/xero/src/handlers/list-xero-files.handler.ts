import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

import type { FileObject } from "xero-node/dist/gen/model/files/fileObject.js";

export async function listXeroFiles(
  page?: number,
  pageSize?: number,
  sort?: "Name" | "Size" | "CreatedDateUTC",
  direction?: "ASC" | "DESC",
): Promise<XeroClientResponse<FileObject[]>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.filesApi.getFiles(
      xeroClient.tenantId,
      pageSize,
      page,
      sort as "Name" | "Size" | "CreatedDateUTC" | undefined,
      direction as "ASC" | "DESC" | undefined,
    );

    return {
      result: response.body.items ?? [],
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
