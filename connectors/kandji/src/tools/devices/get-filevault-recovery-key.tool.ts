import { KandjiUuid } from "../../helpers/kandji-id.js";
import { getDeviceSecret } from "../../handlers/get-device-secret.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetFileVaultRecoveryKeyTool = CreateKandjiTool(
  "get_filevault_recovery_key",
  "SENSITIVE: Get the escrowed FileVault personal recovery key (PRK) for a macOS device. Every successful call is logged to stderr with device ID and timestamp. Only use during active incident response or owner-authenticated recovery — never for bulk export.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
  },
  async ({ device_id }) => {
    const response = await getDeviceSecret(device_id, "filevaultkey");
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

export default GetFileVaultRecoveryKeyTool;
