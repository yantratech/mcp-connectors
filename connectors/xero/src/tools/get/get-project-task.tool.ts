import { z } from "zod";
import { getXeroProjectTask } from "../../handlers/get-xero-project-task.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetProjectTaskTool = CreateXeroTool(
  "get_project_task",
  "Get a specific task within a project from Xero. \
  Use this to see full task details including rate, charge type, and totals.",
  {
    projectId: z
      .string()
      .describe("The ID of the project the task belongs to."),
    taskId: z
      .string()
      .describe(
        "The ID of the task to retrieve. Can be obtained from list_project_tasks.",
      ),
  },
  async ({ projectId, taskId }) => {
    const response = await getXeroProjectTask(projectId, taskId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting project task: ${response.error}`,
          },
        ],
      };
    }

    const task = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Task details:",
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
        },
      ],
    };
  },
);

export default GetProjectTaskTool;
