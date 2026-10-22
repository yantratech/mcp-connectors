import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

// Import asset types from xero-node's assets module
import type { Asset } from "xero-node/dist/gen/model/assets/asset.js";
import { AssetStatusQueryParam } from "xero-node/dist/gen/model/assets/assetStatusQueryParam.js";

export async function listXeroAssets(
  status: "DRAFT" | "REGISTERED" | "DISPOSED",
  page: number = 1,
  pageSize: number = 10,
  orderBy?: "AssetType" | "AssetName" | "AssetNumber" | "PurchaseDate" | "PurchasePrice",
  sortDirection?: "asc" | "desc",
  filterBy?: string,
): Promise<XeroClientResponse<Asset[]>> {
  try {
    await xeroClient.authenticate();

    const statusParam = AssetStatusQueryParam[status];

    const response = await xeroClient.assetApi.getAssets(
      xeroClient.tenantId,
      statusParam,
      page,
      pageSize,
      orderBy,
      sortDirection,
      filterBy,
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
