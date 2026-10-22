import { z } from "zod";
import { listAdeIntegrations } from "../../handlers/ade.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const ListAdeIntegrationsTool = CreateKandjiTool(
  "list_ade_integrations",
  "List Apple Automated Device Enrollment (ADE) tokens configured in the tenant. Each token is a link to an Apple Business Manager / School Manager server and governs which devices can auto-enroll.",
  {
    max_results: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap on total ADE tokens returned"),
  },
  async ({ max_results }) => {
    const response = await listAdeIntegrations(max_results);
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

export default ListAdeIntegrationsTool;
