import { z } from "zod";
import { listXeroProjectTasks } from "../../handlers/list-xero-project-tasks.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListProjectTasksTool = CreateXeroTool(
  "list_project_tasks",
  "List tasks for a specific project in Xero. Tasks represent work items within a project \
  that can be tracked for time and costs.",
  {
    projectId: z
      .string()
      .describe("The ID of the project to list tasks for."),
    page: z
      .number()
      .describe("The page number to retrieve, starting from 1.")
      .optional(),
    pageSize: z
      .number()
      .describe("The number of records per page. Default is 50.")
      .optional(),
  },
  async ({ projectId, page, pageSize }) => {
    const response = await listXeroProjectTasks(projectId, page, pageSize);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing project tasks: ${response.error}`,
          },
        ],
      };
    }

    const tasks = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${tasks?.length || 0} tasks:`,
        },
        ...(tasks?.map((task) => ({
          type: "text" as const,
          text: [
            `Task ID: ${task.taskId}`,
            `Name: ${task.name}`,
            task.rate?.value !== undefined
              ? `Rate: ${task.rate.value} ${task.rate.currency || ""}`
              : null,
            task.chargeType ? `Charge Type: ${task.chargeType}` : null,
            task.estimateMinutes !== undefined
              ? `Estimate Minutes: ${task.estimateMinutes}`
              : null,
            task.totalMinutes !== undefined
              ? `Total Minutes: ${task.totalMinutes}`
              : null,
            task.totalAmount?.value !== undefined
              ? `Total Amount: ${task.totalAmount.value}`
              : null,
            task.status ? `Status: ${task.status}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
);

export default ListProjectTasksTool;
