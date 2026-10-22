import { KandjiUuid } from "../../helpers/kandji-id.js";
import { deleteTag } from "../../handlers/tags-write.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const DeleteTagTool = CreateKandjiTool(
  "delete_tag",
  "Delete a tag. Detaches it from every device that carries it. Blueprint-routing rules that reference this tag will still exist but stop matching.",
  {
    tag_id: KandjiUuid.describe("The tag ID to delete"),
  },
  async ({ tag_id }) => {
    const response = await deleteTag(tag_id);
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

export default DeleteTagTool;
