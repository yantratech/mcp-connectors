import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

import type { AssetType } from "xero-node/dist/gen/model/assets/assetType.js";
import { BookDepreciationSetting } from "xero-node/dist/gen/model/assets/bookDepreciationSetting.js";

interface BookDepreciationSettingInput {
  depreciationMethod: string;
  averagingMethod: string;
  depreciationRate?: number;
  effectiveLifeYears?: number;
  depreciationCalculationMethod: string;
}

interface CreateAssetTypeInput {
  assetTypeName: string;
  fixedAssetAccountId?: string;
  depreciationExpenseAccountId?: string;
  accumulatedDepreciationAccountId?: string;
  bookDepreciationSetting: BookDepreciationSettingInput;
}

export async function createXeroAssetType(
  input: CreateAssetTypeInput,
): Promise<XeroClientResponse<AssetType>> {
  try {
    await xeroClient.authenticate();

    const bookDepreciationSetting: BookDepreciationSetting = {
      depreciationMethod:
        input.bookDepreciationSetting
          .depreciationMethod as unknown as BookDepreciationSetting.DepreciationMethodEnum,
      averagingMethod:
        input.bookDepreciationSetting
          .averagingMethod as unknown as BookDepreciationSetting.AveragingMethodEnum,
      depreciationRate: input.bookDepreciationSetting.depreciationRate,
      effectiveLifeYears: input.bookDepreciationSetting.effectiveLifeYears,
      depreciationCalculationMethod:
        input.bookDepreciationSetting
          .depreciationCalculationMethod as unknown as BookDepreciationSetting.DepreciationCalculationMethodEnum,
    };

    const assetType: AssetType = {
      assetTypeName: input.assetTypeName,
      fixedAssetAccountId: input.fixedAssetAccountId,
      depreciationExpenseAccountId: input.depreciationExpenseAccountId,
      accumulatedDepreciationAccountId: input.accumulatedDepreciationAccountId,
      bookDepreciationSetting,
    };

    const response = await xeroClient.assetApi.createAssetType(
      xeroClient.tenantId,
      assetType,
    );

    if (!response.body) {
      return {
        result: null,
        isError: true,
        error: "Failed to create asset type.",
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
