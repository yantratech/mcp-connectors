import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

import type { Setting } from "xero-node/dist/gen/model/assets/setting.js";

export async function getXeroAssetSettings(): Promise<
  XeroClientResponse<Setting>
> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.assetApi.getAssetSettings(
      xeroClient.tenantId,
    );

    if (!response.body) {
      return {
        result: null,
        isError: true,
        error: "Asset settings not found.",
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
