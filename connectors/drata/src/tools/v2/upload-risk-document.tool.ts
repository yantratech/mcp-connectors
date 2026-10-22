import { z } from "zod";
import { uploadRiskDocument } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const UploadRiskDocumentTool = CreateDrataTool(
  "upload_risk_document",
  "Upload a document to a risk via multipart file upload (V2). Requires Drata Risk Management add-on.",
  {
    riskRegisterId: z
      .number()
      .optional()
      .describe("Risk Register ID. Defaults to DRATA_RISK_REGISTER_ID env var."),
    riskId: z
      .union([z.number(), z.string()])
      .describe('Risk ID or string identifier, e.g. "RISK-001"'),
    fileBase64: z.string().describe("Base64-encoded file content"),
    fileName: z.string().describe("File name including extension"),
  },
  async ({ riskRegisterId, riskId, fileBase64, fileName }) => {
    const file = Uint8Array.from(atob(fileBase64), (c) => c.charCodeAt(0));
    const response = await uploadRiskDocument(riskRegisterId, riskId, file, fileName);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default UploadRiskDocumentTool;
