import { z } from "zod";
import { getXeroFile } from "../../handlers/get-xero-file.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetFileTool = CreateXeroTool(
  "get_file",
  "Get a specific file by ID from Xero Files. \
  Use this to see full details including metadata and folder information.",
  {
    fileId: z
      .string()
      .describe(
        "The ID of the file to retrieve. Can be obtained from list_files.",
      ),
  },
  async ({ fileId }) => {
    const response = await getXeroFile(fileId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting file: ${response.error}`,
          },
        ],
      };
    }

    const file = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "File details:",
            `File ID: ${file.id}`,
            file.name ? `Name: ${file.name}` : null,
            file.mimeType ? `MIME Type: ${file.mimeType}` : null,
            file.size !== undefined ? `Size: ${file.size}` : null,
            file.createdDateUtc ? `Created: ${file.createdDateUtc}` : null,
            file.updatedDateUtc ? `Updated: ${file.updatedDateUtc}` : null,
            file.user ? `User: ${file.user.name}` : null,
            file.folderId ? `Folder ID: ${file.folderId}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default GetFileTool;
