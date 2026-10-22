import { KandjiUuid } from "../../helpers/kandji-id.js";
import { getDeviceSecret } from "../../handlers/get-device-secret.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetUnlockPinTool = CreateKandjiTool(
  "get_unlock_pin",
  "SENSITIVE: Get the unlock PIN set by a prior Lock Device MDM command. Every successful call is logged to stderr.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
  },
  async ({ device_id }) => {
    const response = await getDeviceSecret(device_id, "unlockpin");
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

export default GetUnlockPinTool;
