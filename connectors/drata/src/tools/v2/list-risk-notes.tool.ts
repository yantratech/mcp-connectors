import { z } from "zod";
import { listRiskNotes } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ListRiskNotesTool = CreateDrataTool(
  "list_risk_notes",
  "List all notes on a risk (V2). Works on the base tier once a riskRegisterId is known — pass riskRegisterId or set DRATA_RISK_REGISTER_ID; only the register enumerator (list_risk_registers) is Pro-gated.",
  {
    riskRegisterId: z
      .number()
      .optional()
      .describe("Risk Register ID. Defaults to DRATA_RISK_REGISTER_ID env var."),
    riskId: z
      .number()
      .describe(
        "INTERNAL numeric risk id (get_risk's `id`), NOT the \"R-0xx\" display code — a display code's number silently matches nothing here.",
      ),
    cursor: z.string().optional().describe("Pagination cursor"),
    size: z.number().optional().describe("Page size"),
    sort: z.string().optional().describe("Sort field, e.g. createdAt or updatedAt"),
    sortDir: z.enum(["ASC", "DESC"]).optional().describe("Sort direction"),
    expand: z
      .array(z.string())
      .optional()
      .describe("Related fields to expand. Known value: owner (the note author)."),
  },
  async ({ riskRegisterId, riskId, cursor, size, sort, sortDir, expand }) => {
    const response = await listRiskNotes(riskRegisterId, riskId, {
      cursor,
      size,
      sort,
      sortDir,
      expand,
    });
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListRiskNotesTool;
