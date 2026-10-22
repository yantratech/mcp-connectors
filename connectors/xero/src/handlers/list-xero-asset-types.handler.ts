import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

import type { AssetType } from "xero-node/dist/gen/model/assets/assetType.js";

export async function listXeroAssetTypes(): Promise<
  XeroClientResponse<AssetType[]>
> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.assetApi.getAssetTypes(
      xeroClient.tenantId,
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
