import axios from "axios";
import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

import type { Asset } from "xero-node/dist/gen/model/assets/asset.js";

interface CreateAssetInput {
  assetName: string;
  assetNumber?: string;
  assetTypeId?: string;
  purchaseDate?: string;
  depreciationStartDate?: string;
  purchasePrice?: number;
  serialNumber?: string;
  warrantyExpiryDate?: string;
}

export async function createXeroAsset(
  input: CreateAssetInput,
): Promise<XeroClientResponse<Asset>> {
  try {
    await xeroClient.authenticate();

    // Build the raw payload ourselves so the SDK serializer cannot strip
    // fields that are missing from its attributeTypeMap (depreciationStartDate).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: Record<string, any> = {
      assetName: input.assetName,
      assetNumber: input.assetNumber,
      assetTypeId: input.assetTypeId,
      purchaseDate: input.purchaseDate,
      purchasePrice: input.purchasePrice,
      serialNumber: input.serialNumber,
      warrantyExpiryDate: input.warrantyExpiryDate,
    };

    // If assetTypeId is provided, fetch the asset type's depreciation defaults
    // and merge them into the payload. The Xero API does not auto-populate
    // depreciation settings from the asset type (that's a UI-only behaviour).
    if (input.assetTypeId) {
      const typesResponse = await xeroClient.assetApi.getAssetTypes(
        xeroClient.tenantId,
      );
      const assetType = typesResponse.body?.find(
        (t) => t.assetTypeId === input.assetTypeId,
      );
      if (assetType?.bookDepreciationSetting) {
        const src = assetType.bookDepreciationSetting;
        payload.bookDepreciationSetting = {
          depreciationMethod: src.depreciationMethod,
          averagingMethod: src.averagingMethod,
          depreciationRate: src.depreciationRate,
          effectiveLifeYears: src.effectiveLifeYears,
          depreciationCalculationMethod: src.depreciationCalculationMethod,
        };
      }
    }

    // depreciationStartDate belongs in bookDepreciationDetail, not bookDepreciationSetting
    const startDate = input.depreciationStartDate || input.purchaseDate;
    if (startDate) {
      payload.bookDepreciationDetail = {
        depreciationStartDate: startDate,
      };
    }

    // Direct HTTP call to bypass the SDK's ObjectSerializer which strips
    // depreciationStartDate (not in its attributeTypeMap).
    const tokenSet = xeroClient.readTokenSet();
    const response = await axios.post(
      "https://api.xero.com/assets.xro/1.0/Assets",
      payload,
      {
        headers: {
          Authorization: `Bearer ${tokenSet.access_token}`,
          "xero-tenant-id": xeroClient.tenantId,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      },
    );

    if (!response.data) {
      return {
        result: null,
        isError: true,
        error: "Failed to create asset.",
      };
    }

    return {
      result: response.data as Asset,
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
