import { KandjiId, KandjiUuid } from "../../helpers/kandji-id.js";
import { getDeviceNote } from "../../handlers/get-device-note.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetDeviceNoteTool = CreateKandjiTool(
  "get_device_note",
  "Retrieve a single note attached to a device by note ID.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
    note_id: KandjiId.describe("The Kandji note ID"),
  },
  async ({ device_id, note_id }) => {
    const response = await getDeviceNote(device_id, note_id);
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

export default GetDeviceNoteTool;
