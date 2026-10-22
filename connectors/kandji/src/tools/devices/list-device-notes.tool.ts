import { KandjiUuid } from "../../helpers/kandji-id.js";
import { listDeviceNotes } from "../../handlers/list-device-notes.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const ListDeviceNotesTool = CreateKandjiTool(
  "list_device_notes",
  "List the notes attached to a device (free-text admin annotations — often used for ticket references, investigation notes, or onboarding context). Caveat: the API 200-empties for nonexistent device IDs — an empty result does not prove the device exists (the response flags this; get_device 404s loudly).",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
  },
  async ({ device_id }) => {
    const response = await listDeviceNotes(device_id);
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

export default ListDeviceNotesTool;
