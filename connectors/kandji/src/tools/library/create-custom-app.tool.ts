import { z } from "zod";
import { KandjiFilterId } from "../../helpers/kandji-id.js";
import { createCustomApp } from "../../handlers/library-write.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const CreateCustomAppTool = CreateKandjiTool(
  "create_custom_app",
  "Create a Custom App library item — the metadata record that points at an installer (.pkg/.dmg/.zip) already uploaded via upload_custom_app_binary. Sends POST /library/custom-apps. Returns the created library item including its new ID. Both `file_key` (from upload_custom_app_binary) and `install_type` are required by the API; omitting either returns 400 (Invalid value) or 500 (no install_type).",
  {
    name: z.string().min(1).describe("Display name for the Custom App"),
    file_key: z
      .string()
      .min(1)
      .describe(
        "S3 file_key from a prior upload_custom_app_binary response. Required by the API — a 400 'Invalid value' is returned otherwise.",
      ),
    install_type: z
      .enum(["package", "zip", "image"])
      .describe(
        "How Kandji unpacks the installer. Required by the API; missing values return 500. 'package' = .pkg, 'zip' = .zip extracted to /Applications, 'image' = .dmg mounted and copied.",
      ),
    install_enforcement: z
      .string()
      .optional()
      .describe(
        "When the installer runs (e.g. 'install_once', 'continuously_enforce', 'no_enforcement').",
      ),
    audit_script: z
      .string()
      .optional()
      .describe("Audit-and-enforce shell script content (macOS only)"),
    preinstall_script: z
      .string()
      .optional()
      .describe("Preinstall shell script content (macOS only)"),
    postinstall_script: z
      .string()
      .optional()
      .describe("Postinstall shell script content (macOS only)"),
    show_in_self_service: z
      .boolean()
      .optional()
      .describe("Whether the app is exposed in Self Service"),
    self_service_category_id: KandjiFilterId.optional()
      .describe(
        "Self Service category ID — see list_self_service_categories",
      ),
    blueprints: z
      .array(z.string())
      .optional()
      .describe("Blueprint IDs to assign this Custom App to on creation"),
  },
  async (args) => {
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (value !== undefined) payload[key] = value;
    }
    const response = await createCustomApp(payload);
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

export default CreateCustomAppTool;
