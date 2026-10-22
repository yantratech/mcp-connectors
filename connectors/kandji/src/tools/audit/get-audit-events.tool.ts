import { z } from "zod";
import { getAuditEvents } from "../../handlers/get-audit-events.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const GetAuditEventsTool = CreateKandjiTool(
  "get_audit_events",
  "Get the admin audit log — every change made in the Kandji console (blueprint edits, library-item changes, user management, API key use). Primary source for SOC 2 evidence and admin-action forensics. Returns { returned, truncated, next_offset?, note?, events } — DEFAULT IS ONE 50-EVENT PAGE, not the full log (the tenant log can be huge and grows with every API call). When truncated is true, page with start_offset = next_offset, or narrow with start_date/end_date; a full-log walk requires explicitly raising max_results.",
  {
    start_date: z
      .string()
      .optional()
      .describe("ISO 8601 start date (inclusive), e.g. 2025-01-01T00:00:00Z"),
    end_date: z
      .string()
      .optional()
      .describe("ISO 8601 end date (inclusive)"),
    max_results: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Cap on total events returned per call. Defaults to 50; raising it far beyond a few hundred fetches the whole tenant log (slow, very large).",
      ),
    start_offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Resume cursor: pass the previous response's next_offset (with identical filters) to fetch the next page.",
      ),
  },
  async ({ start_date, end_date, max_results, start_offset }) => {
    const response = await getAuditEvents(
      { startDate: start_date, endDate: end_date },
      max_results,
      start_offset,
    );
    if (response.isError) {
      return renderToolError(response);
    }
    // Compact serialization — audit events average ~1.2k JSON chars each
    // (18k+ outliers); pretty-printing adds ~35% for no model benefit.
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(response.result),
        },
      ],
    };
  },
);

export default GetAuditEventsTool;
