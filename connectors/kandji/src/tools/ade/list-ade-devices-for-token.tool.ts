import { z } from "zod";
import { KandjiId } from "../../helpers/kandji-id.js";
import { listAdeDevicesForToken } from "../../handlers/ade.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const ListAdeDevicesForTokenTool = CreateKandjiTool(
  "list_ade_devices_for_token",
  "List devices assigned to a specific ADE token. Use to audit per-token assignment after acquiring new hardware batches.",
  {
    ade_token_id: KandjiId.describe("The ADE token ID"),
    max_results: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap on total devices returned"),
  },
  async ({ ade_token_id, max_results }) => {
    const response = await listAdeDevicesForToken(ade_token_id, max_results);
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

export default ListAdeDevicesForTokenTool;
