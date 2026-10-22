import { z } from "zod";
import { listXeroFiles } from "../../handlers/list-xero-files.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListFilesTool = CreateXeroTool(
  "list_files",
  "Lists files stored in Xero Files. Use this to browse uploaded documents, receipts, and attachments.",
  {
    page: z.number().describe("Page number for pagination.").optional(),
    pageSize: z.number().describe("Number of files per page.").optional(),
    sort: z
      .enum(["Name", "Size", "CreatedDateUTC"])
      .describe("Field to sort results by.")
      .optional(),
    direction: z
      .enum(["ASC", "DESC"])
      .describe("Sort direction.")
      .optional(),
  },
  async ({ page, pageSize, sort, direction }) => {
    const response = await listXeroFiles(page, pageSize, sort, direction);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing files: ${response.error}`,
          },
        ],
      };
    }

    const files = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${files?.length || 0} files:`,
        },
        ...(files?.map((file) => ({
          type: "text" as const,
          text: [
            `File: ${file.name || "Unnamed"}`,
            `ID: ${file.id}`,
            file.mimeType ? `MIME Type: ${file.mimeType}` : null,
            file.size !== undefined ? `Size: ${file.size}` : null,
            file.createdDateUtc ? `Created: ${file.createdDateUtc}` : null,
            file.folderId ? `Folder ID: ${file.folderId}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
);

export default ListFilesTool;
