import { z } from "zod";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  getTempFile,
  registerTempFile,
} from "../../helpers/attachment-temp-files.js";

const PrepareAttachmentTool = CreateXeroTool(
  "prepare_attachment",
  "Buffer base64-encoded file content to a temporary file in chunks. \
  Call this tool repeatedly with chunks of base64-encoded data to build up \
  a file without consuming the entire conversation context at once. \
  On the first call, omit tempFileId to create a new temp file. \
  On subsequent calls, pass the returned tempFileId to append to the same file. \
  When all chunks have been written, use the returned filePath with upload_attachment or upload_file \
  (only files staged here, or under the operator-configured XERO_UPLOAD_DIR, can be uploaded).",
  {
    chunk: z
      .string()
      .describe(
        "A chunk of base64-encoded file content. Keep chunks under 100KB of base64 text to avoid filling the conversation context.",
      ),
    tempFileId: z
      .string()
      .optional()
      .describe(
        "The temporary file ID returned by a previous call. Omit on the first call to create a new temp file.",
      ),
    fileName: z
      .string()
      .optional()
      .describe(
        "Original file name, used to set the temp file extension. Only needed on the first call.",
      ),
  },
  async ({ chunk, tempFileId, fileName }) => {
    try {
      let filePath: string;
      let id: string;

      const existing = tempFileId ? getTempFile(tempFileId) : undefined;
      if (tempFileId && existing) {
        // Append to existing temp file
        id = tempFileId;
        filePath = existing;
      } else {
        // Create a new temp file
        id = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const ext = fileName ? path.extname(fileName) : "";
        filePath = path.join(os.tmpdir(), `xero-attachment-${id}${ext}`);
        registerTempFile(id, filePath);
      }

      const decoded = Buffer.from(chunk, "base64");
      fs.appendFileSync(filePath, decoded);

      const stats = fs.statSync(filePath);

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Chunk received (${decoded.length} bytes decoded).`,
              `Temp file ID: ${id}`,
              `File path: ${filePath}`,
              `Total size so far: ${stats.size} bytes`,
              `Pass tempFileId "${id}" to append more chunks, or use filePath with upload_attachment when done.`,
            ].join("\n"),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error preparing attachment: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },
);

export default PrepareAttachmentTool;
