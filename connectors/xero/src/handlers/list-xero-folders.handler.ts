import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

import type { Folder } from "xero-node/dist/gen/model/files/folder.js";

export async function listXeroFolders(
  sort?: "Name" | "Size" | "CreatedDateUTC",
): Promise<XeroClientResponse<Folder[]>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.filesApi.getFolders(
      xeroClient.tenantId,
      sort,
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
