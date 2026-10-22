import { z } from "zod";
import { createXeroAssetType } from "../../handlers/create-xero-asset-type.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const CreateAssetTypeTool = CreateXeroTool(
  "create_asset_type",
  "Create an asset type in Xero. Asset types define depreciation settings \
  that are applied to assets of that type. \
  Use list_accounts to find the correct account IDs for fixed asset, \
  depreciation expense, and accumulated depreciation accounts.",
  {
    assetTypeName: z
      .string()
      .describe("The name of the asset type (e.g. 'Computer Equipment')."),
    fixedAssetAccountId: z
      .string()
      .describe(
        "The account ID for the fixed asset account. Use list_accounts to find this.",
      )
      .optional(),
    depreciationExpenseAccountId: z
      .string()
      .describe(
        "The account ID for the depreciation expense account. Use list_accounts to find this.",
      )
      .optional(),
    accumulatedDepreciationAccountId: z
      .string()
      .describe(
        "The account ID for the accumulated depreciation account. Use list_accounts to find this.",
      )
      .optional(),
    bookDepreciationSetting: z
      .object({
        depreciationMethod: z
          .enum([
            "NoDepreciation",
            "StraightLine",
            "DiminishingValue100",
            "DiminishingValue150",
            "DiminishingValue200",
            "FullDepreciation",
          ])
          .describe("The depreciation method to use."),
        averagingMethod: z
          .enum(["FullMonth", "ActualDays"])
          .describe("The averaging method for depreciation calculation."),
        depreciationRate: z
          .number()
          .describe("The depreciation rate as a percentage (e.g. 20 for 20%).")
          .optional(),
        effectiveLifeYears: z
          .number()
          .describe("The effective life of the asset in years.")
          .optional(),
        depreciationCalculationMethod: z
          .enum(["Rate", "Life", "None"])
          .describe(
            "How depreciation is calculated. Use 'Rate' with depreciationRate or 'Life' with effectiveLifeYears.",
          ),
      })
      .describe("The book depreciation settings for this asset type."),
  },
  async ({
    assetTypeName,
    fixedAssetAccountId,
    depreciationExpenseAccountId,
    accumulatedDepreciationAccountId,
    bookDepreciationSetting,
  }) => {
    const result = await createXeroAssetType({
      assetTypeName,
      fixedAssetAccountId,
      depreciationExpenseAccountId,
      accumulatedDepreciationAccountId,
      bookDepreciationSetting,
    });

    if (result.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error creating asset type: ${result.error}`,
          },
        ],
      };
    }

    const assetType = result.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Asset type created successfully:",
            `Asset Type ID: ${assetType.assetTypeId}`,
            `Name: ${assetType.assetTypeName}`,
            assetType.fixedAssetAccountId
              ? `Fixed Asset Account ID: ${assetType.fixedAssetAccountId}`
              : null,
            assetType.depreciationExpenseAccountId
              ? `Depreciation Expense Account ID: ${assetType.depreciationExpenseAccountId}`
              : null,
            assetType.accumulatedDepreciationAccountId
              ? `Accumulated Depreciation Account ID: ${assetType.accumulatedDepreciationAccountId}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default CreateAssetTypeTool;
