import { z } from "zod";
import { updateXeroTimeEntry } from "../../handlers/update-xero-time-entry.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const UpdateTimeEntryTool = CreateXeroTool(
  "update_time_entry",
  "Update an existing time entry within a Xero project. All fields (userId, taskId, \
  dateUtc, duration) are required by the API. Use get_time_entry to retrieve current values.",
  {
    projectId: z
      .string()
      .describe("The ID of the project the time entry belongs to."),
    timeEntryId: z
      .string()
      .describe(
        "The ID of the time entry to update. Can be obtained from list_time_entries.",
      ),
    userId: z
      .string()
      .describe("The ID of the user for the time entry."),
    taskId: z
      .string()
      .describe("The ID of the task for the time entry."),
    dateUtc: z
      .string()
      .describe("The date of the time entry in ISO 8601 format (e.g. '2024-01-15')."),
    duration: z
      .number()
      .describe("The duration in minutes (1-59940)."),
    description: z
      .string()
      .describe("A description of the work done.")
      .optional(),
  },
  async ({ projectId, timeEntryId, userId, taskId, dateUtc, duration, description }) => {
    const result = await updateXeroTimeEntry({
      projectId,
      timeEntryId,
      userId,
      taskId,
      dateUtc,
      duration,
      description,
    });

    if (result.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error updating time entry: ${result.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Successfully updated time entry with ID: ${timeEntryId} in project: ${projectId}`,
        },
      ],
    };
  },
);

export default UpdateTimeEntryTool;
