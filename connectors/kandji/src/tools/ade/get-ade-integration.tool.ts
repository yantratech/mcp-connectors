import { KandjiId } from "../../helpers/kandji-id.js";
import { getAdeIntegration } from "../../handlers/ade.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetAdeIntegrationTool = CreateKandjiTool(
  "get_ade_integration",
  "Get a single ADE token — its MDM server link, default blueprint, expiry, and last sync time. Useful when auditing renewal deadlines.",
  {
    ade_token_id: KandjiId.describe("The ADE token ID"),
  },
  async ({ ade_token_id }) => {
    const response = await getAdeIntegration(ade_token_id);
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

export default GetAdeIntegrationTool;
