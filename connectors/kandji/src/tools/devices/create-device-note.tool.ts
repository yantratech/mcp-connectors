import { z } from "zod";
import { KandjiUuid } from "../../helpers/kandji-id.js";
import { createDeviceNote } from "../../handlers/device-notes-write.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const CreateDeviceNoteTool = CreateKandjiTool(
  "create_device_note",
  "Attach a free-text note to a device — typically a ticket reference, investigation finding, or onboarding context. Supports a basic HTML subset (p, br, strong, em, a).",
  {
    device_id: KandjiUuid.describe("The Kandji device ID"),
    content: z.string().min(1).describe("The note body (HTML subset allowed)"),
  },
  async ({ device_id, content }) => {
    const response = await createDeviceNote(device_id, content);
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
  { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
);

export default CreateDeviceNoteTool;
