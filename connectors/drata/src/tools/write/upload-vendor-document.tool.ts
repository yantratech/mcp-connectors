import { z } from "zod";
import { uploadVendorDocument } from "../../handlers/write-vendors.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const UploadVendorDocumentTool = CreateDrataTool(
  "upload_vendor_document",
  "Upload a document to a vendor for security review evidence. File must have a proper extension matching its content (.pdf, .png, .jpg, .xlsx, .docx).",
  {
    vendorId: z.number().describe("The vendor ID to attach the document to"),
    filePath: z.string().describe("Absolute path to the file to upload"),
  },
  async ({ vendorId, filePath }) => {
    const response = await uploadVendorDocument(vendorId, filePath);
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

export default UploadVendorDocumentTool;
