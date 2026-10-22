import { z } from "zod";
import { listEventsV2 } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";
import type { DrataQueryParams } from "../../clients/drata-client.js";

const ListEventsV2Tool = CreateDrataTool(
  "list_events_v2",
  "List recent events (V2). Returns a single page sorted newest-first by " +
    "default. Use `cursor` from `pagination.cursor` to fetch subsequent " +
    "pages, or refine with `since` (ISO date) to bound the time range.",
  {
    size: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe("Per-page size (1–500, default 50). Larger pages = bigger response."),
    cursor: z
      .string()
      .optional()
      .describe("Cursor from a previous response's `pagination.cursor`."),
    sort: z
      .enum(["createdAt", "updatedAt"])
      .optional()
      .describe("Sort field (default createdAt)."),
    sortDir: z
      .enum(["ASC", "DESC"])
      .optional()
      .describe("Sort direction (default DESC)."),
    since: z
      .string()
      .optional()
      .describe(
        "ISO date — only return events at or after this timestamp (filtered client-side; unparsable values are rejected loudly, never silently ignored). Maps to Drata's `createdAtFrom`.",
      ),
    type: z
      .string()
      .optional()
      .describe("Filter by event type (e.g. CONTROL_UPDATED)."),
    category: z
      .string()
      .optional()
      .describe("Filter by event category."),
  },
  async ({ size, cursor, sort, sortDir, since, type, category }) => {
    const params: DrataQueryParams = { size, cursor, sort, sortDir, type, category };
    if (since !== undefined) {
      params.createdAtFrom = since;
    }
    const response = await listEventsV2(params);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListEventsV2Tool;
