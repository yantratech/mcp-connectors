import { KandjiUuid } from "../../helpers/kandji-id.js";
import { getDeviceSecret } from "../../handlers/get-device-secret.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetActivationLockBypassCodeTool = CreateKandjiTool(
  "get_activation_lock_bypass_code",
  "SENSITIVE: Get the Activation Lock bypass code for a device. Required to un-stick an iPhone/iPad/Mac that has Activation Lock engaged after a wipe. Every successful call is logged to stderr.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
  },
  async ({ device_id }) => {
    const response = await getDeviceSecret(device_id, "bypasscode");
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

export default GetActivationLockBypassCodeTool;
