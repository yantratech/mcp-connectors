import { z } from "zod";
import { listUsers } from "../../handlers/list-users.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const ListUsersTool = CreateKandjiTool(
  "list_users",
  "List end-users in the Kandji directory (typically synced from an IdP). Returns id, email, name, department, job_title, device_count, and active/archived flags per user, with a leading active/archived count breakdown — this endpoint does NOT expose group memberships. Archived users are included in count and flagged per-record. Filter by email.",
  {
    email: z.string().optional().describe("Filter by exact email address"),
    max_results: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap on total users returned"),
  },
  async ({ email, max_results }) => {
    const response = await listUsers({ email }, max_results);
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

export default ListUsersTool;
