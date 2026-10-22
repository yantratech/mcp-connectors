import { z } from "zod";
import { uploadXeroFile } from "../../handlers/upload-xero-file.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const UploadFileTool = CreateXeroTool(
  "upload_file",
  "Upload a file to the Xero Files API. Uploads to the inbox by default, \
  or to a specific folder if folderId is provided. \
  Once uploaded, use create_file_association to link it to an invoice, \
  contact, or other Xero object.",
  {
    filePath: z
      .string()
      .describe(
        "Absolute path of a local file to upload. Only files staged with prepare_attachment, or inside the directory set by the XERO_UPLOAD_DIR environment variable, are accepted; symlinks, non-regular files and files over 10 MB are refused.",
      ),
    fileName: z
      .string()
      .describe(
        "The name the file should have in Xero (e.g. 'Invoice 97587.pdf').",
      ),
    mimeType: z
      .string()
      .describe(
        "The MIME type of the file (e.g. 'application/pdf', 'image/png', 'image/jpeg').",
      ),
    folderId: z
      .string()
      .optional()
      .describe(
        "Optional folder ID to upload into. If omitted, the file goes to the inbox.",
      ),
  },
  async ({ filePath, fileName, mimeType, folderId }) => {
    const result = await uploadXeroFile(filePath, fileName, mimeType, folderId);

    if (result.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error uploading file: ${result.error}`,
          },
        ],
      };
    }

    const file = result.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "File uploaded successfully:",
            `File ID: ${file.id}`,
            `Name: ${file.name}`,
            file.mimeType ? `Type: ${file.mimeType}` : null,
            file.size !== undefined ? `Size: ${file.size} bytes` : null,
            file.folderId ? `Folder ID: ${file.folderId}` : null,
            "",
            "To attach this file to an invoice or other entity, use create_file_association with the File ID above.",
          ]
            .filter((line) => line !== null)
            .join("\n"),
        },
      ],
    };
  },
);

export default UploadFileTool;
