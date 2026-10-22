import { z } from "zod";
import { createAsset } from "../../handlers/write-assets.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ASSET_CLASS_TYPES = [
  "HARDWARE",
  "POLICY",
  "DOCUMENT",
  "PERSONNEL",
  "SOFTWARE",
  "CODE",
  "CONTAINER",
  "COMPUTE",
  "NETWORKING",
  "DATABASE",
  "STORAGE",
] as const;

const CreateAssetTool = CreateDrataTool(
  "create_asset",
  "Create a new asset in the Drata asset inventory.",
  {
    name: z.string().max(191).describe("Asset name"),
    description: z.string().max(191).describe("Asset description"),
    assetClassTypes: z
      .array(z.enum(ASSET_CLASS_TYPES))
      .min(1)
      .describe("Asset class types (one or more)"),
    assetType: z
      .enum(["PHYSICAL", "VIRTUAL"])
      .describe("Physical or virtual asset"),
    ownerId: z
      .number()
      .describe(
        "User ID of the asset owner (use list_personnel to find IDs)",
      ),
  },
  async (args) => {
    const response = await createAsset(args);
    if (response.isError) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${response.error}` }],
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(response.result, null, 2),
        },
      ],
    };
  },
);

export default CreateAssetTool;
