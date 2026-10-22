import { z } from "zod";
import { uploadOffboardingDocument } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const UploadOffboardingDocumentTool = CreateDrataTool(
  "upload_offboarding_document",
  "Upload an offboarding evidence document for a user via multipart upload (V2).",
  {
    userId: z.number().describe("ID of the user"),
    fileBase64: z.string().describe("Base64-encoded file content"),
    fileName: z.string().describe("File name including extension"),
  },
  async ({ userId, fileBase64, fileName }) => {
    const file = Uint8Array.from(atob(fileBase64), (c) => c.charCodeAt(0));
    const response = await uploadOffboardingDocument(userId, file, fileName);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default UploadOffboardingDocumentTool;
