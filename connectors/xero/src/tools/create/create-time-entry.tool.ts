import { z } from "zod";
import { createXeroTimeEntry } from "../../handlers/create-xero-time-entry.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const CreateTimeEntryTool = CreateXeroTool(
  "create_time_entry",
  "Create a time entry against a project task in Xero. Records work done by a user \
  on a specific date. Duration is in minutes (1-59940). \
  Use list_project_users to get user IDs and list_project_tasks to get task IDs.",
  {
    projectId: z
      .string()
      .describe("The ID of the project to log time against."),
    userId: z
      .string()
      .describe("The ID of the user logging the time. Can be obtained from list_project_users."),
    taskId: z
      .string()
      .describe("The ID of the task to log time against. Can be obtained from list_project_tasks."),
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
  async ({ projectId, userId, taskId, dateUtc, duration, description }) => {
    const result = await createXeroTimeEntry({
      projectId,
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
            text: `Error creating time entry: ${result.error}`,
          },
        ],
      };
    }

    const entry = result.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Time entry created successfully:",
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

export default CreateTimeEntryTool;
