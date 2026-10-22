import { z } from "zod";
import { createCustomProfile } from "../../handlers/library-write.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const CreateCustomProfileTool = CreateKandjiTool(
  "create_custom_profile",
  "Create a Custom Profile library item — wraps an Apple .mobileconfig payload that Kandji deploys to assigned devices via MDM. Sends POST /library/custom-profiles as multipart/form-data with the mobileconfig XML in the `file` part. Returns the created library item including its new ID. At least one device family must be enabled (defaults to runs_on_mac=true). Use assign_library_item afterwards to attach the profile to specific blueprints.",
  {
    name: z.string().min(1).describe("Display name for the Custom Profile"),
    mobileconfig: z
      .string()
      .min(1)
      .describe(
        "Raw .mobileconfig XML content — uploaded as the `file` field of the multipart request. Must be a valid signed-or-unsigned Configuration Profile.",
      ),
    runs_on_mac: z
      .boolean()
      .optional()
      .describe(
        "Target macOS devices. Defaults to true if no other runs_on_* flag is set; the API requires at least one device family enabled.",
      ),
    runs_on_iphone: z.boolean().optional().describe("Target iPhone devices."),
    runs_on_ipad: z.boolean().optional().describe("Target iPad devices."),
    runs_on_tv: z.boolean().optional().describe("Target Apple TV devices."),
    runs_on_vision: z
      .boolean()
      .optional()
      .describe("Target Apple Vision Pro devices."),
  },
  async ({
    name,
    mobileconfig,
    runs_on_mac,
    runs_on_iphone,
    runs_on_ipad,
    runs_on_tv,
    runs_on_vision,
  }) => {
    const flags = {
      runs_on_mac,
      runs_on_iphone,
      runs_on_ipad,
      runs_on_tv,
      runs_on_vision,
    };
    // Distinguish "no flag specified" (default to mac, matching the Kandji
    // UI) from "flags specified but none true" (caller excluded every
    // family — an explicit runs_on_mac: false must NOT be inverted to true).
    const anySpecified = Object.values(flags).some((v) => v !== undefined);
    const anyTrue = Object.values(flags).some((v) => v === true);
    if (anySpecified && !anyTrue) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Error: at least one runs_on_* flag must be true — the API rejects a profile with no device family. Omit all runs_on_* flags to default to runs_on_mac: true.",
          },
        ],
      };
    }
    const payload = {
      name,
      mobileconfig,
      // The API rejects requests without a target family; default to mac
      // only when the caller specified NO flag at all.
      runs_on_mac: anySpecified ? runs_on_mac : true,
      runs_on_iphone,
      runs_on_ipad,
      runs_on_tv,
      runs_on_vision,
    };
    const response = await createCustomProfile(payload);
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

export default CreateCustomProfileTool;
