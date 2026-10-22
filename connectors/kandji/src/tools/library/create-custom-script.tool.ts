import { z } from "zod";
import { KandjiFilterId } from "../../helpers/kandji-id.js";
import { createCustomScript } from "../../handlers/library-write.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const CreateCustomScriptTool = CreateKandjiTool(
  "create_custom_script",
  "Create a Custom Script library item — a shell script Kandji runs on assigned macOS devices on a schedule or on-demand. Sends POST /library/custom-scripts. Returns the created library item including its new ID. Pair with assign_library_item to roll out to a blueprint.",
  {
    name: z.string().min(1).describe("Display name for the Custom Script"),
    script: z
      .string()
      .min(1)
      .describe(
        "Shell script content (the audit script in Kandji's UI vocabulary). Exit 0 = no remediation needed; non-zero = remediate. Sent to the API as the `script` field.",
      ),
    remediation_script: z
      .string()
      .optional()
      .describe(
        "Remediation script content; runs only when the audit script exits non-zero.",
      ),
    execution_frequency: z
      .string()
      .optional()
      .describe(
        "How often to run (e.g. 'every_check_in', 'every_day', 'every_15_min', 'no_enforcement', 'once'). Defaults to Kandji's default.",
      ),
    show_in_self_service: z.boolean().optional(),
    self_service_category_id: KandjiFilterId.optional(),
    blueprints: z
      .array(z.string())
      .optional()
      .describe("Blueprint IDs to assign this script to on creation"),
  },
  async (args) => {
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (value !== undefined) payload[key] = value;
    }
    const response = await createCustomScript(payload);
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

export default CreateCustomScriptTool;
