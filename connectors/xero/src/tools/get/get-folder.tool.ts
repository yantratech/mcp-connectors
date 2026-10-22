import { z } from "zod";
import { getXeroFolder } from "../../handlers/get-xero-folder.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetFolderTool = CreateXeroTool(
  "get_folder",
  "Get a specific folder by ID from Xero Files. \
  Use this to see full folder details including file count and email.",
  {
    folderId: z
      .string()
      .describe(
        "The ID of the folder to retrieve. Can be obtained from list_folders.",
      ),
  },
  async ({ folderId }) => {
    const response = await getXeroFolder(folderId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting folder: ${response.error}`,
          },
        ],
      };
    }

    const folder = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Folder details:",
            `Folder ID: ${folder.id}`,
            folder.name ? `Name: ${folder.name}` : null,
            folder.fileCount !== undefined ? `File Count: ${folder.fileCount}` : null,
            folder.email ? `Email: ${folder.email}` : null,
            folder.isInbox !== undefined ? `Is Inbox: ${folder.isInbox}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default GetFolderTool;
