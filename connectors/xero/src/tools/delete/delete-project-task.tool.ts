import { z } from "zod";
import { deleteXeroProjectTask } from "../../handlers/delete-xero-project-task.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const DeleteProjectTaskTool = CreateXeroTool(
  "delete_project_task",
  "Delete a task from a Xero project. This will permanently remove the task.",
  {
    projectId: z
      .string()
      .describe("The ID of the project the task belongs to."),
    taskId: z
      .string()
      .describe("The ID of the task to delete."),
  },
  async (params: { projectId: string; taskId: string }) => {
    const { projectId, taskId } = params;
    const response = await deleteXeroProjectTask(projectId, taskId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error deleting project task: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Successfully deleted task with ID: ${taskId} from project: ${projectId}`,
        },
      ],
    };
  },
);

export default DeleteProjectTaskTool;
