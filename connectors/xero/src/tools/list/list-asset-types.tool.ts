import { listXeroAssetTypes } from "../../handlers/list-xero-asset-types.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListAssetTypesTool = CreateXeroTool(
  "list_asset_types",
  "List fixed asset types in Xero. Asset types define categories for fixed assets \
  with default depreciation settings. Use this to get asset type IDs for creating assets.",
  {},
  async () => {
    const response = await listXeroAssetTypes();

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing asset types: ${response.error}`,
          },
        ],
      };
    }

    const types = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${types?.length || 0} asset types:`,
        },
        ...(types?.map((assetType) => ({
          type: "text" as const,
          text: [
            `Type ID: ${assetType.assetTypeId}`,
            `Name: ${assetType.assetTypeName}`,
            assetType.fixedAssetAccountId
              ? `Fixed Asset Account: ${assetType.fixedAssetAccountId}`
              : null,
            assetType.depreciationExpenseAccountId
              ? `Depreciation Expense Account: ${assetType.depreciationExpenseAccountId}`
              : null,
            assetType.accumulatedDepreciationAccountId
              ? `Accumulated Depreciation Account: ${assetType.accumulatedDepreciationAccountId}`
              : null,
            assetType.bookDepreciationSetting
              ? `Depreciation Method: ${assetType.bookDepreciationSetting.depreciationMethod || "N/A"}`
              : null,
            assetType.bookDepreciationSetting?.depreciationRate !== undefined
              ? `Depreciation Rate: ${assetType.bookDepreciationSetting.depreciationRate}%`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
);

export default ListAssetTypesTool;
