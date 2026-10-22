import { z } from "zod";
import { getXeroTimeEntry } from "../../handlers/get-xero-time-entry.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetTimeEntryTool = CreateXeroTool(
  "get_time_entry",
  "Get a specific time entry within a project from Xero. \
  Use this to see full details of a logged time entry.",
  {
    projectId: z
      .string()
      .describe("The ID of the project the time entry belongs to."),
    timeEntryId: z
      .string()
      .describe(
        "The ID of the time entry to retrieve. Can be obtained from list_time_entries.",
      ),
  },
  async ({ projectId, timeEntryId }) => {
    const response = await getXeroTimeEntry(projectId, timeEntryId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting time entry: ${response.error}`,
          },
        ],
      };
    }

    const entry = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Time entry details:",
            `Time Entry ID: ${entry.timeEntryId}`,
            entry.userId ? `User ID: ${entry.userId}` : null,
            entry.taskId ? `Task ID: ${entry.taskId}` : null,
            entry.dateUtc ? `Date: ${entry.dateUtc}` : null,
            entry.duration !== undefined ? `Duration: ${entry.duration}` : null,
            entry.description ? `Description: ${entry.description}` : null,
            entry.status ? `Status: ${entry.status}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default GetTimeEntryTool;
