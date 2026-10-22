import { z } from "zod";
import { listXeroUsers } from "../../handlers/list-xero-users.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListUsersTool = CreateXeroTool(
  "list_users",
  "List the users of the Xero organisation. \
  Use this to resolve the user IDs and names that history records, approvals, \
  and audit trails reference.",
  {
    where: z
      .string()
      .optional()
      .describe(
        'Optional filter by any user element, e.g. EmailAddress=="john@example.com" or OrganisationRole=="STANDARD".',
      ),
    order: z
      .string()
      .optional()
      .describe('Optional sort order, e.g. "LastName ASC".'),
  },
  async ({ where, order }) => {
    const response = await listXeroUsers(where, order);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing users: ${response.error}`,
          },
        ],
      };
    }

    const users = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${users?.length || 0} users:`,
        },
        ...(users?.map((user) => ({
          type: "text" as const,
          text: [
            `User ID: ${user.userID}`,
            `Name: ${[user.firstName, user.lastName].filter(Boolean).join(" ") || "Unnamed"}`,
            user.emailAddress ? `Email: ${user.emailAddress}` : null,
            user.organisationRole
              ? `Organisation Role: ${user.organisationRole}`
              : null,
            user.isSubscriber !== undefined
              ? `Is Subscriber: ${user.isSubscriber}`
              : null,
            user.updatedDateUTC
              ? `Last Updated: ${user.updatedDateUTC}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
);

export default ListUsersTool;
