import { z } from "zod";
import { requestCustomAppUpload } from "../../handlers/library-write.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const UploadCustomAppBinaryTool = CreateKandjiTool(
  "upload_custom_app_binary",
  "Step 1 of 2 for uploading a Custom App installer (.pkg/.dmg/.zip): requests a presigned S3 URL from Kandji. Sends POST /library/custom-apps/upload with the file name and returns { post_url, post_data, file_key, expiry }. The caller must then perform a multipart-form POST of the binary to post_url with post_data, then call create_custom_app (or update_custom_app) referencing the returned file_key. The binary upload itself is OUT OF SCOPE for this MCP wrapper because it is multipart binary, not JSON.",
  {
    name: z
      .string()
      .min(1)
      .describe(
        "Filename of the installer being uploaded (e.g. 'Slack-4.40.0.pkg')",
      ),
  },
  async ({ name }) => {
    const response = await requestCustomAppUpload(name);
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

export default UploadCustomAppBinaryTool;
