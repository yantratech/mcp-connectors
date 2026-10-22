import { getXeroAssetSettings } from "../../handlers/get-xero-asset-settings.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetAssetSettingsTool = CreateXeroTool(
  "get_asset_settings",
  "Get the fixed asset settings for the Xero organisation. \
  Shows the default asset start date, last depreciation date, and other configuration.",
  {},
  async () => {
    const response = await getXeroAssetSettings();

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting asset settings: ${response.error}`,
          },
        ],
      };
    }

    const settings = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Asset settings:",
            settings.assetNumberPrefix
              ? `Number Prefix: ${settings.assetNumberPrefix}`
              : null,
            settings.assetNumberSequence
              ? `Number Sequence: ${settings.assetNumberSequence}`
              : null,
            settings.assetStartDate
              ? `Start Date: ${settings.assetStartDate}`
              : null,
            settings.lastDepreciationDate
              ? `Last Depreciation Date: ${settings.lastDepreciationDate}`
              : null,
            settings.defaultGainOnDisposalAccountId
              ? `Default Gain on Disposal Account: ${settings.defaultGainOnDisposalAccountId}`
              : null,
            settings.defaultLossOnDisposalAccountId
              ? `Default Loss on Disposal Account: ${settings.defaultLossOnDisposalAccountId}`
              : null,
            settings.defaultCapitalGainOnDisposalAccountId
              ? `Default Capital Gain Account: ${settings.defaultCapitalGainOnDisposalAccountId}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default GetAssetSettingsTool;
