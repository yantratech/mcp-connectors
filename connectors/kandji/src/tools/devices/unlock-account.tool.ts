import { z } from "zod";
import { KandjiUuid } from "../../helpers/kandji-id.js";
import { triggerDeviceAction } from "../../handlers/device-actions.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const UnlockAccountTool = CreateKandjiTool(
  "unlock_account",
  "Queue an MDM 'UnlockUserAccount' command that clears a locked-out local user account on macOS (after too many failed password attempts). Requires the local account shortname — the same identifier delete_user takes — because the MDM command operates on a specific user, not the whole device. Sends POST /devices/{id}/action/unlockaccount and returns the queued command record. Use after a confirmed password lockout so the user can sign back in without a wipe. Every successful call is logged to stderr.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
    user_name: z
      .string()
      .min(1)
      .describe(
        "The local user shortname to unlock (the macOS account name, not display name)",
      ),
  },
  async ({ device_id, user_name }) => {
    const response = await triggerDeviceAction(device_id, "unlockaccount", {
      UserName: user_name,
    });
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

export default UnlockAccountTool;
