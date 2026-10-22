import { z } from "zod";
import { KandjiUuid } from "../../helpers/kandji-id.js";
import { updateTag } from "../../handlers/tags-write.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const UpdateTagTool = CreateKandjiTool(
  "update_tag",
  "Rename an existing tag. Propagates the new name to all devices that carry it.",
  {
    tag_id: KandjiUuid.describe("The tag ID"),
    name: z.string().min(1).describe("New tag name"),
  },
  async ({ tag_id, name }) => {
    const response = await updateTag(tag_id, name);
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

export default UpdateTagTool;
