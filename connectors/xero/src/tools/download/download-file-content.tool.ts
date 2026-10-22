import path from "path";
import { z } from "zod";

import { downloadXeroFileContent } from "../../handlers/download-xero-file-content.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const DownloadFileContentTool = CreateXeroTool(
  "download_file_content",
  "Download the binary content of a file from the Xero file library to a local path. \
  Resolves the file's name and MIME type from its metadata first, then writes the \
  bytes directly to outputPath (never returned inline). \
  Use list_files to find file IDs.",
  {
    fileId: z
      .string()
      .describe(
        "The ID of the file to download. Can be obtained from list_files.",
      ),
    outputPath: z
      .string()
      .refine((value) => path.isAbsolute(value), {
        message: "outputPath must be an absolute path",
      })
      .describe(
        "Absolute local file path to write the file to. \
        The parent directory must already exist.",
      ),
    overwrite: z
      .boolean()
      .optional()
      .describe(
        "Replace an existing file at outputPath. Defaults to false (refuse to overwrite).",
      ),
  },
  async ({ fileId, outputPath, overwrite }) => {
    const response = await downloadXeroFileContent(
      fileId,
      outputPath,
      overwrite ?? false,
    );

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error downloading file content: ${response.error}`,
          },
        ],
      };
    }

    const download = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "File downloaded:",
            `Path: ${download.path}`,
            `Size: ${download.sizeBytes} bytes`,
            `File Name: ${download.fileName}`,
            `MIME Type: ${download.mimeType}`,
            download.folderId ? `Folder ID: ${download.folderId}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default DownloadFileContentTool;
