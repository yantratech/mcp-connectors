import { z } from "zod";
import { listXeroTimeEntries } from "../../handlers/list-xero-time-entries.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListTimeEntriesTool = CreateXeroTool(
  "list_time_entries",
  "List time entries for a specific project in Xero. Time entries record work done \
  by users against project tasks.",
  {
    projectId: z
      .string()
      .describe("The ID of the project to list time entries for."),
    userId: z
      .string()
      .describe("Filter time entries by user ID.")
      .optional(),
    taskId: z
      .string()
      .describe("Filter time entries by task ID.")
      .optional(),
    page: z
      .number()
      .describe("The page number to retrieve, starting from 1.")
      .optional(),
    pageSize: z
      .number()
      .describe("The number of records per page. Default is 50.")
      .optional(),
    dateAfterUtc: z
      .string()
      .describe("Filter time entries after this date (ISO 8601 format).")
      .optional(),
    dateBeforeUtc: z
      .string()
      .describe("Filter time entries before this date (ISO 8601 format).")
      .optional(),
  },
  async ({ projectId, userId, taskId, page, pageSize, dateAfterUtc, dateBeforeUtc }) => {
    const response = await listXeroTimeEntries(
      projectId,
      userId,
      taskId,
      page,
      pageSize,
      dateAfterUtc,
      dateBeforeUtc,
    );

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing time entries: ${response.error}`,
          },
        ],
      };
    }

    const entries = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${entries?.length || 0} time entries:`,
        },
        ...(entries?.map((entry) => ({
          type: "text" as const,
          text: [
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
        })) || []),
      ],
    };
  },
);

export default ListTimeEntriesTool;
