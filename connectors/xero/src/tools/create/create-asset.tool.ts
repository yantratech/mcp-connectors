import { z } from "zod";
import { createXeroAsset } from "../../handlers/create-xero-asset.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const CreateAssetTool = CreateXeroTool(
  "create_asset",
  "Create a fixed asset in Xero. Fixed assets are items of value owned by the business. \
  The asset will be created in DRAFT status. \
  When assetTypeId is provided, depreciation settings (method, rate, effective life) are \
  automatically inherited from the asset type — no need to specify them manually. \
  Use list_asset_types to get available asset type IDs (e.g. Computer Equipment, Office Equipment).",
  {
    assetName: z
      .string()
      .describe("The name of the asset (e.g. 'MacBook Pro 16-inch')."),
    assetNumber: z
      .string()
      .describe("A unique asset number (e.g. 'FA-0001'). Required by Xero — the API rejects requests without it."),
    assetTypeId: z
      .string()
      .describe(
        "The ID of the asset type — REQUIRED for registration. Without this, depreciation fields will be blank and the asset cannot be registered. Use list_asset_types to get IDs.",
      ),
    purchaseDate: z
      .string()
      .describe("The purchase date (YYYY-MM-DD format). Also used as the depreciation start date if depreciationStartDate is not provided."),
    depreciationStartDate: z
      .string()
      .describe(
        "The date depreciation starts (YYYY-MM-DD format). Defaults to purchaseDate if not provided. Required by Xero when depreciation settings are present.",
      )
      .optional(),
    purchasePrice: z
      .number()
      .describe("The purchase price of the asset."),
    serialNumber: z
      .string()
      .describe("The serial number of the asset.")
      .optional(),
    warrantyExpiryDate: z
      .string()
      .describe("The warranty expiry date (YYYY-MM-DD format).")
      .optional(),
  },
  async ({
    assetName,
    assetNumber,
    assetTypeId,
    purchaseDate,
    depreciationStartDate,
    purchasePrice,
    serialNumber,
    warrantyExpiryDate,
  }) => {
    const result = await createXeroAsset({
      assetName,
      assetNumber,
      assetTypeId,
      purchaseDate,
      depreciationStartDate,
      purchasePrice,
      serialNumber,
      warrantyExpiryDate,
    });

    if (result.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error creating asset: ${result.error}`,
          },
        ],
      };
    }

    const asset = result.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Asset created successfully:",
            `Asset ID: ${asset.assetId}`,
            `Name: ${asset.assetName}`,
            asset.assetNumber ? `Number: ${asset.assetNumber}` : null,
            asset.assetStatus ? `Status: ${asset.assetStatus}` : null,
            asset.purchaseDate ? `Purchase Date: ${asset.purchaseDate}` : null,
            asset.purchasePrice !== undefined
              ? `Purchase Price: ${asset.purchasePrice}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default CreateAssetTool;
