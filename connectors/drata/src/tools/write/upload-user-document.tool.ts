import { z } from "zod";
import { uploadUserDocument } from "../../handlers/write-evidence.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const USER_DOC_TYPES = [
  "SEC_TRAINING",
  "MFA_EVIDENCE",
  "HIPAA_TRAINING_EVIDENCE",
  "OFFBOARDING_EVIDENCE",
] as const;

const UploadUserDocumentTool = CreateDrataTool(
  "upload_user_document",
  "Upload a compliance document for a specific user (training cert, MFA evidence, offboarding). File must have a proper extension (.pdf, .png, .jpg, .xlsx, .docx). Use list_personnel to find user IDs.",
  {
    userId: z.number().describe("The user ID to attach the document to"),
    filePath: z.string().describe("Absolute path to the file to upload"),
    type: z
      .enum(USER_DOC_TYPES)
      .describe(
        "Document type — determines which compliance requirement this satisfies",
      ),
  },
  async ({ userId, filePath, type }) => {
    const response = await uploadUserDocument(userId, filePath, type);
    if (response.isError) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${response.error}` }],
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(response.result, null, 2),
        },
      ],
    };
  },
);

export default UploadUserDocumentTool;
