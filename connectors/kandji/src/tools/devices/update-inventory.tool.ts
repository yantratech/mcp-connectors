import { KandjiUuid } from "../../helpers/kandji-id.js";
import { triggerUpdateInventory } from "../../handlers/device-refresh-actions.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const UpdateInventoryTool = CreateKandjiTool(
  "update_inventory",
  "Queue a non-destructive 'UpdateInventory' MDM command that forces the device to re-report its inventory (installed apps, hardware, compliance state). No user-visible effect; refreshes stale data. Every successful call is logged to stderr.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
  },
  async ({ device_id }) => {
    const response = await triggerUpdateInventory(device_id);
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

export default UpdateInventoryTool;
