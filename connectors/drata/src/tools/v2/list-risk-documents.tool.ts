import { z } from "zod";
import { listRiskDocuments } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ListRiskDocumentsTool = CreateDrataTool(
  "list_risk_documents",
  "List all documents attached to a risk (V2). Requires Drata Risk Management Pro; without it Drata returns HTTP 402. Listing does not support downloadUrl/expand (Drata returns 500); use get_risk_document with expand:[\"downloadUrl\"] for a download link.",
  {
    riskRegisterId: z
      .number()
      .optional()
      .describe("Risk Register ID. Defaults to DRATA_RISK_REGISTER_ID env var."),
    riskId: z
      .union([z.number(), z.string()])
      .describe('Risk ID or string identifier, e.g. "RISK-001"'),
    cursor: z.string().optional().describe("Pagination cursor"),
    size: z.number().optional().describe("Page size"),
    includeTotalCount: z.boolean().optional().describe("Ask Drata to include total count"),
  },
  async ({ riskRegisterId, riskId, cursor, size, includeTotalCount }) => {
    const response = await listRiskDocuments(riskRegisterId, riskId, {
      cursor,
      size,
      includeTotalCount,
    });
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListRiskDocumentsTool;
