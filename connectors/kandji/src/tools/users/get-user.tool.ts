import { KandjiId } from "../../helpers/kandji-id.js";
import { getUser } from "../../handlers/get-user.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetUserTool = CreateKandjiTool(
  "get_user",
  "Get details for a single Kandji user by user ID (email, name, department, job_title, active/archived flags). Note: the response carries only a device_count integer, NOT a device list — to enumerate a user's devices, call list_devices with user_email.",
  {
    user_id: KandjiId.describe("The Kandji user ID"),
  },
  async ({ user_id }) => {
    const response = await getUser(user_id);
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

export default GetUserTool;
