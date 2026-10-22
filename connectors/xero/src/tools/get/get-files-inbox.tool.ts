import { getXeroFilesInbox } from "../../handlers/get-xero-files-inbox.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetFilesInboxTool = CreateXeroTool(
  "get_files_inbox",
  "Get the Inbox folder from Xero Files, including its folder ID, file count, \
  and the email address used to email documents into the inbox. \
  Note: the Xero Files API cannot list files filtered by folder, so to review \
  inbox contents use list_files with sort CreatedDateUTC and direction DESC \
  (recently added files are usually the inbox arrivals).",
  {},
  async () => {
    const response = await getXeroFilesInbox();

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting files inbox: ${response.error}`,
          },
        ],
      };
    }

    const inbox = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Inbox folder details:",
            `Folder ID: ${inbox.id}`,
            inbox.name ? `Name: ${inbox.name}` : null,
            inbox.fileCount !== undefined
              ? `File Count: ${inbox.fileCount}`
              : null,
            inbox.email ? `Inbox Email: ${inbox.email}` : null,
            inbox.isInbox !== undefined ? `Is Inbox: ${inbox.isInbox}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default GetFilesInboxTool;
