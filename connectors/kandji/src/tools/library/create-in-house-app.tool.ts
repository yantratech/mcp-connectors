import { z } from "zod";
import { KandjiFilterId } from "../../helpers/kandji-id.js";
import { createInHouseApp } from "../../handlers/library-write.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const CreateInHouseAppTool = CreateKandjiTool(
  "create_in_house_app",
  "Create an In-House (IPA) App library item — Kandji deploys an enterprise-signed iOS/iPadOS .ipa to assigned devices. Sends POST /library/ipa-apps. Returns the created library item including its new ID. Use upload_in_house_app_binary first to obtain a file_key for the .ipa payload.",
  {
    name: z.string().min(1).describe("Display name for the In-House App"),
    file_key: z
      .string()
      .min(1)
      .describe(
        "S3 file_key from a prior upload_in_house_app_binary response. Required by the API — a 400 'This field is required' is returned otherwise.",
      ),
    install_enforcement: z
      .string()
      .optional()
      .describe(
        "When the app is installed (e.g. 'install_once', 'continuously_enforce', 'no_enforcement').",
      ),
    show_in_self_service: z.boolean().optional(),
    self_service_category_id: KandjiFilterId.optional(),
    blueprints: z
      .array(z.string())
      .optional()
      .describe("Blueprint IDs to assign this app to on creation"),
  },
  async (args) => {
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (value !== undefined) payload[key] = value;
    }
    const response = await createInHouseApp(payload);
    if (response.isError) {
      return renderToolError(response);
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
  { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
);

export default CreateInHouseAppTool;
