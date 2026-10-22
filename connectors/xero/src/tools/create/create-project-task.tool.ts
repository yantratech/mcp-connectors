import { z } from "zod";
import { createXeroProjectTask } from "../../handlers/create-xero-project-task.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const CreateProjectTaskTool = CreateXeroTool(
  "create_project_task",
  "Create a new task within a Xero project. Tasks represent work items that can be \
  tracked for time and costs. A charge type must be specified: TIME, FIXED, or NON_CHARGEABLE.",
  {
    projectId: z
      .string()
      .describe("The ID of the project to create the task in."),
    name: z
      .string()
      .describe("The name of the task."),
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
  async ({ projectId, name, rateCurrency, rateValue, chargeType, estimateMinutes }) => {
    const result = await createXeroProjectTask({
      projectId,
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
            text: `Error creating project task: ${result.error}`,
          },
        ],
      };
    }

    const task = result.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Task created successfully:",
            `Task ID: ${task.taskId}`,
            `Name: ${task.name}`,
            task.rate?.value !== undefined
              ? `Rate: ${task.rate.value} ${task.rate.currency || ""}`
              : null,
            task.chargeType ? `Charge Type: ${task.chargeType}` : null,
            task.estimateMinutes !== undefined
              ? `Estimate Minutes: ${task.estimateMinutes}`
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

export default CreateProjectTaskTool;
