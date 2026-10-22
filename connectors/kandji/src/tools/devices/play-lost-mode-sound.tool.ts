import { KandjiUuid } from "../../helpers/kandji-id.js";
import { triggerDeviceAction } from "../../handlers/device-actions.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const PlayLostModeSoundTool = CreateKandjiTool(
  "play_lost_mode_sound",
  "Queue an MDM 'PlayLostModeSound' command (supervised iOS/iPadOS only) that plays a loud locator chime on a device already in Lost Mode. Sends POST /devices/{id}/action/playlostmodesound. Use to help a colleague physically locate a missing device once it's online. Every successful call is logged to stderr.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
  },
  async ({ device_id }) => {
    const response = await triggerDeviceAction(device_id, "playlostmodesound");
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

export default PlayLostModeSoundTool;
