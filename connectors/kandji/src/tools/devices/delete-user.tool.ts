import { z } from "zod";
import { KandjiUuid } from "../../helpers/kandji-id.js";
import { triggerDeviceAction } from "../../handlers/device-actions.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const DeleteUserTool = CreateKandjiTool(
  "delete_user",
  "DESTRUCTIVE: queues an MDM 'DeleteUser' command that removes a local user account on the device — including that user's home directory and all of their files. Irreversible. Sends POST /devices/{id}/action/deleteuser. Use only for confirmed offboarding when the account on this device is no longer needed. Every successful call is logged to stderr.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
    user_name: z
      .string()
      .min(1)
      .describe(
        "The local user shortname to delete (the macOS account name, not display name)",
      ),
  },
  async ({ device_id, user_name }) => {
    const response = await triggerDeviceAction(device_id, "deleteuser", {
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
  { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
);

export default DeleteUserTool;
