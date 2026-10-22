import { z } from "zod";
import { KandjiId, KandjiUuid } from "../../helpers/kandji-id.js";
import { updateDeviceNote } from "../../handlers/device-notes-write.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const UpdateDeviceNoteTool = CreateKandjiTool(
  "update_device_note",
  "Edit an existing device note by ID. Overwrites the content; history is tracked in the audit log.",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
    note_id: KandjiId.describe("The note ID to update"),
    content: z.string().min(1).describe("New note body"),
  },
  async ({ device_id, note_id, content }) => {
    const response = await updateDeviceNote(device_id, note_id, content);
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

export default UpdateDeviceNoteTool;
