import { z } from "zod";
import { updateXeroProjectTask } from "../../handlers/update-xero-project-task.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const UpdateProjectTaskTool = CreateXeroTool(
  "update_project_task",
  "Update an existing task within a Xero project. The task name and charge type are required. \
  Use get_project_task to retrieve current values before updating.",
  {
    projectId: z
      .string()
      .describe("The ID of the project the task belongs to."),
    taskId: z
      .string()
      .describe(
        "The ID of the task to update. Can be obtained from list_project_tasks.",
      ),
    name: z
      .string()
      .describe("The name of the task (required by the API)."),
    rateCurrency: z
      .string()
      .describe("The currency code for the task rate (e.g. 'GBP'). Defaults to GBP.")
      .optional(),
    rateValue: z
      .number()
      .describe("The rate value for the task.")
      .optional(),
    chargeType: z
      .enum(["TIME", "FIXED", "NON_CHARGEABLE"])
      .describe("The charge type for the task: TIME, FIXED, or NON_CHARGEABLE."),
    estimateMinutes: z
      .number()
      .describe("The estimated number of minutes for the task.")
      .optional(),
  },
  async ({ projectId, taskId, name, rateCurrency, rateValue, chargeType, estimateMinutes }) => {
    const result = await updateXeroProjectTask({
      projectId,
      taskId,
      name,
      rateCurrency,
      rateValue,
      chargeType,
      estimateMinutes,
    });

    if (result.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error updating project task: ${result.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Successfully updated task with ID: ${taskId} in project: ${projectId}`,
        },
      ],
    };
  },
);

export default UpdateProjectTaskTool;
