import { KandjiId, KandjiUuid } from "../../helpers/kandji-id.js";
import { deleteDeviceNote } from "../../handlers/device-notes-write.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const DeleteDeviceNoteTool = CreateKandjiTool(
  "delete_device_note",
  "Delete a device note by ID. Returns a deletion receipt including deleted_at timestamp.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
    note_id: KandjiId.describe("The note ID to delete"),
  },
  async ({ device_id, note_id }) => {
    const response = await deleteDeviceNote(device_id, note_id);
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

export default DeleteDeviceNoteTool;
