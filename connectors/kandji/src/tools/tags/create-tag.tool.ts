import { z } from "zod";
import { createTag } from "../../handlers/tags-write.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const CreateTagTool = CreateKandjiTool(
  "create_tag",
  "Create a new tag. Tags are freeform string labels that can be applied to devices and used as filter criteria for blueprint routing and library-item assignment.",
  {
    name: z.string().min(1).describe("Tag name"),
  },
  async ({ name }) => {
    const response = await createTag(name);
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

export default CreateTagTool;
