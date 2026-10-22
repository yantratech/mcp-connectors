import { z } from "zod";
import { listAdeDevices } from "../../handlers/ade.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const ListAdeDevicesTool = CreateKandjiTool(
  "list_ade_devices",
  "List every ADE-eligible device across all tokens — serial, model, color, asset tag, assigned blueprint and user. Covers devices that haven't enrolled yet.",
  {
    max_results: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap on total ADE devices returned"),
  },
  async ({ max_results }) => {
    const response = await listAdeDevices(max_results);
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

export default ListAdeDevicesTool;
