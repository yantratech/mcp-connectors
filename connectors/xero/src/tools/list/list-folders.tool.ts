import { z } from "zod";
import { listXeroFolders } from "../../handlers/list-xero-folders.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListFoldersTool = CreateXeroTool(
  "list_folders",
  "Lists all folders in Xero Files. Use this to see how files are organised.",
  {
    sort: z.string().describe("Sort order for folders.").optional(),
  },
  async ({ sort }) => {
    const response = await listXeroFolders(sort as "Name" | "Size" | "CreatedDateUTC" | undefined);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing folders: ${response.error}`,
          },
        ],
      };
    }

    const folders = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${folders?.length || 0} folders:`,
        },
        ...(folders?.map((folder) => ({
          type: "text" as const,
          text: [
            `Folder: ${folder.name || "Unnamed"}`,
            `ID: ${folder.id}`,
            folder.fileCount !== undefined ? `File Count: ${folder.fileCount}` : null,
            folder.isInbox !== undefined ? `Is Inbox: ${folder.isInbox}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
);

export default ListFoldersTool;
