import { z } from "zod";
import { listXeroAssets } from "../../handlers/list-xero-assets.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListAssetsTool = CreateXeroTool(
  "list_assets",
  "List fixed assets in Xero. Fixed assets are items of value that a business owns, \
  such as equipment, vehicles, or buildings. Status is required. \
  Ask the user which status they want to filter by: DRAFT, REGISTERED, or DISPOSED.",
  {
    status: z
      .enum(["DRAFT", "REGISTERED", "DISPOSED"])
      .optional()
      .describe("The status of assets to retrieve. Defaults to REGISTERED if not provided."),
    page: z
      .number()
      .describe("The page number to retrieve, starting from 1.")
      .optional(),
    pageSize: z
      .number()
      .describe("The number of records per page. Default is 10.")
      .optional(),
    orderBy: z
      .enum(["AssetType", "AssetName", "AssetNumber", "PurchaseDate", "PurchasePrice"])
      .describe("Field to order results by.")
      .optional(),
    sortDirection: z
      .enum(["asc", "desc"])
      .describe("Sort direction. Default is asc.")
      .optional(),
    filterBy: z
      .string()
      .describe("Filter text to search across AssetName, AssetNumber, Description, and AssetTypeName.")
      .optional(),
  },
  async ({ status, page, pageSize, orderBy, sortDirection, filterBy }) => {
    const response = await listXeroAssets(
      status ?? "REGISTERED",
      page ?? 1,
      pageSize ?? 10,
      orderBy,
      sortDirection,
      filterBy,
    );

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing assets: ${response.error}`,
          },
        ],
      };
    }

    const assets = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${assets?.length || 0} assets:`,
        },
        ...(assets?.map((asset) => ({
          type: "text" as const,
          text: [
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
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
);

export default ListAssetsTool;
