import { z } from "zod";
import { getXeroAsset } from "../../handlers/get-xero-asset.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetAssetTool = CreateXeroTool(
  "get_asset",
  "Get a specific fixed asset by ID from Xero. \
  Use this to see full details including depreciation settings and book value.",
  {
    assetId: z
      .string()
      .describe(
        "The ID of the asset to retrieve. Can be obtained from list_assets.",
      ),
  },
  async ({ assetId }) => {
    const response = await getXeroAsset(assetId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting asset: ${response.error}`,
          },
        ],
      };
    }

    const asset = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Asset details:",
            `Asset ID: ${asset.assetId}`,
            `Name: ${asset.assetName}`,
            asset.assetNumber ? `Number: ${asset.assetNumber}` : null,
            asset.assetStatus ? `Status: ${asset.assetStatus}` : null,
            asset.assetTypeId ? `Type ID: ${asset.assetTypeId}` : null,
            asset.purchaseDate ? `Purchase Date: ${asset.purchaseDate}` : null,
            asset.purchasePrice !== undefined
              ? `Purchase Price: ${asset.purchasePrice}`
              : null,
            asset.serialNumber
              ? `Serial Number: ${asset.serialNumber}`
              : null,
            asset.accountingBookValue !== undefined
              ? `Book Value: ${asset.accountingBookValue}`
              : null,
            asset.warrantyExpiryDate
              ? `Warranty Expires: ${asset.warrantyExpiryDate}`
              : null,
            asset.disposalDate
              ? `Disposal Date: ${asset.disposalDate}`
              : null,
            asset.disposalPrice !== undefined
              ? `Disposal Price: ${asset.disposalPrice}`
              : null,
            asset.bookDepreciationSetting
              ? `Depreciation Method: ${asset.bookDepreciationSetting.depreciationMethod || "N/A"}`
              : null,
            asset.bookDepreciationSetting?.depreciationRate !== undefined
              ? `Depreciation Rate: ${asset.bookDepreciationSetting.depreciationRate}%`
              : null,
            asset.bookDepreciationDetail?.currentCapitalGain !== undefined
              ? `Capital Gain: ${asset.bookDepreciationDetail.currentCapitalGain}`
              : null,
            asset.bookDepreciationDetail?.currentGainLoss !== undefined
              ? `Gain/Loss: ${asset.bookDepreciationDetail.currentGainLoss}`
              : null,
            asset.canRollback !== undefined
              ? `Can Rollback: ${asset.canRollback}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default GetAssetTool;
