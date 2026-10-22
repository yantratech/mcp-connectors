import { KandjiUuid } from "../../helpers/kandji-id.js";
import { getDeviceSecret } from "../../handlers/get-device-secret.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetRecoveryLockPasswordTool = CreateKandjiTool(
  "get_recovery_lock_password",
  "SENSITIVE: Get the Recovery Lock password for an Apple silicon Mac. Required to boot into recoveryOS. Every successful call is logged to stderr.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
  },
  async ({ device_id }) => {
    const response = await getDeviceSecret(device_id, "recoverypassword");
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
);

export default GetRecoveryLockPasswordTool;
