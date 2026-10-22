import { z } from "zod";
import { listXeroProjectUsers } from "../../handlers/list-xero-project-users.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListProjectUsersTool = CreateXeroTool(
  "list_project_users",
  "List users available for Xero Projects. These are the users who can be assigned \
  to projects and log time entries.",
  {
    page: z
      .number()
      .describe("The page number to retrieve, starting from 1.")
      .optional(),
    pageSize: z
      .number()
      .describe("The number of records per page. Default is 50.")
      .optional(),
  },
  async ({ page, pageSize }) => {
    const response = await listXeroProjectUsers(page, pageSize);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing project users: ${response.error}`,
          },
        ],
      };
    }

    const users = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${users?.length || 0} project users:`,
        },
        ...(users?.map((user) => ({
          type: "text" as const,
          text: [
            `User ID: ${user.userId}`,
            user.name ? `Name: ${user.name}` : null,
            user.email ? `Email: ${user.email}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
);

export default ListProjectUsersTool;
