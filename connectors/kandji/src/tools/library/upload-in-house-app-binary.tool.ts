import { z } from "zod";
import { requestInHouseAppUpload } from "../../handlers/library-write.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const UploadInHouseAppBinaryTool = CreateKandjiTool(
  "upload_in_house_app_binary",
  "Step 1 of 2 for uploading an In-House (IPA) App binary: requests a presigned S3 URL from Kandji. Sends POST /library/ipa-apps/upload (which uses the `filename` field — note the asymmetry with custom-apps/upload, which uses `name`) and returns { post_url, post_data, file_key, expires, sha256, id }. The caller must then perform a multipart-form POST of the .ipa to post_url with post_data, then call create_in_house_app referencing the returned file_key. The S3 binary upload itself is OUT OF SCOPE for this MCP wrapper (multipart binary, not JSON).",
  {
    filename: z
      .string()
      .min(1)
      .describe("Filename of the .ipa being uploaded (e.g. 'InternalApp.ipa')"),
  },
  async ({ filename }) => {
    const response = await requestInHouseAppUpload(filename);
    if (response.isError) {
      return renderToolError(response);
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
  { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
);

export default UploadInHouseAppBinaryTool;
