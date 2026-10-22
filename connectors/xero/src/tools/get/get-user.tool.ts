import { z } from "zod";
import { getXeroUser } from "../../handlers/get-xero-user.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetUserTool = CreateXeroTool(
  "get_user",
  "Get a specific user of the Xero organisation by ID. \
  Use this to resolve a user ID referenced by history records or approvals \
  to a name, email address, and organisation role.",
  {
    userId: z
      .string()
      .describe(
        "The ID of the user to retrieve. Can be obtained from list_users or from history records.",
      ),
  },
  async ({ userId }) => {
    const response = await getXeroUser(userId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting user: ${response.error}`,
          },
        ],
      };
    }

    const user = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "User details:",
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
        },
      ],
    };
  },
);

export default GetUserTool;
