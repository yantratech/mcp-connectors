import { z } from "zod";
import { getRecentEvents } from "../../handlers/get-recent-events.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const GetRecentEventsTool = CreateDrataTool(
  "get_recent_events",
  "Get the newest activity events from Drata (max 50 per call — NOT the full history; use list_events_v2 for cursor pagination and time filters). Each event carries the upstream status: PASSED/FAILED/ERROR for check events, null for non-check activity — read it before treating an event's description as a passing result.",
  {
    limit: z
      .number()
      .optional()
      .describe(
        "Number of recent events to return, 1-50; values above 50 are clamped to 50 (upstream cap). Defaults to 20.",
      ),
  },
  async ({ limit }) => {
    const response = await getRecentEvents(limit);

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

export default GetRecentEventsTool;
