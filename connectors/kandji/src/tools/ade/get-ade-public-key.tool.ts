import { getAdePublicKey } from "../../handlers/ade.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetAdePublicKeyTool = CreateKandjiTool(
  "get_ade_public_key",
  "Download the Kandji ADE public key used to upload a fresh MDM server token to Apple Business Manager / School Manager.",
  {},
  async () => {
    const response = await getAdePublicKey();
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
  { readOnlyHint: true, idempotentHint: true },
);

export default GetAdePublicKeyTool;
