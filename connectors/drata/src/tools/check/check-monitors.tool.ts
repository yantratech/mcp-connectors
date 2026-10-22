import { z } from "zod";
import { checkMonitors } from "../../handlers/check-monitors.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const CheckMonitorsTool = CreateDrataTool(
  "check_monitors",
  "Check automated monitoring test results. Leads with tenant-wide statusCounts " +
    "(passing/failing/error/testing/disabled), then a paginated monitor list " +
    "(default 50 per page; iterate with `page` while hasMore). Entries are " +
    "compact; failureDetails (Drata's static failure template, not a live " +
    "diagnostic) appears only on failing/error monitors.",
  {
    filter: z
      .enum(["all", "failing", "error", "passing", "testing", "disabled"])
      .optional()
      .describe(
        "Filter monitors by status. Defaults to all. `failing` includes ERROR-state monitors; `error` isolates just the ERROR ones (checks that ran but could not evaluate); `testing` isolates monitors Drata is transiently re-evaluating.",
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Return only selected fields per monitor, e.g. ["id", "name", "status"]. Opt-in extras beyond the compact default: "description" (static pass-criteria template), "checkStatus".',
      ),
    size: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe("Per-page size (1–500, default 50)."),
    page: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("1-based page number (default 1)."),
  },
  async ({ filter, fields, size, page }) => {
    const response = await checkMonitors(filter, { fields, size, page });

    if (response.isError) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${response.error}` }],
      };
    }

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(response.result, null, 2) },
      ],
    };
  },
);

export default CheckMonitorsTool;
