import { z } from "zod";
import { KandjiUuid } from "../../helpers/kandji-id.js";
import { triggerDeviceAction } from "../../handlers/device-actions.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const EnableLostModeTool = CreateKandjiTool(
  "enable_lost_mode",
  "Queue an MDM 'EnableLostMode' command (supervised iOS/iPadOS only) that puts the device into Lost Mode — locks the screen, disables Find My device removal, and lets you pin a custom message + phone number on the lock screen. Sends POST /devices/{id}/action/enablelostmode. Apple's MDM spec accepts an optional Message, PhoneNumber, and Footnote — supply at least one for the lock screen to be useful. Pair with play_lost_mode_sound and update_location to track a missing device. Every successful call is logged to stderr.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
    message: z
      .string()
      .optional()
      .describe(
        "Optional message shown on the locked screen (e.g. 'This iPad is lost — please call …').",
      ),
    phone_number: z
      .string()
      .optional()
      .describe(
        "Optional callback phone number displayed on the locked screen.",
      ),
    footnote: z
      .string()
      .optional()
      .describe(
        "Optional footnote shown alongside the message at the bottom of the locked screen.",
      ),
  },
  async ({ device_id, message, phone_number, footnote }) => {
    const payload: Record<string, unknown> = {};
    if (message !== undefined) payload.Message = message;
    if (phone_number !== undefined) payload.PhoneNumber = phone_number;
    if (footnote !== undefined) payload.Footnote = footnote;

    const response = await triggerDeviceAction(
      device_id,
      "enablelostmode",
      Object.keys(payload).length > 0 ? payload : undefined,
    );
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
  { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
);

export default EnableLostModeTool;
