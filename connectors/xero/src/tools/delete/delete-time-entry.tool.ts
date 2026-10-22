import { z } from "zod";
import { deleteXeroTimeEntry } from "../../handlers/delete-xero-time-entry.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const DeleteTimeEntryTool = CreateXeroTool(
  "delete_time_entry",
  "Delete a time entry from a Xero project. This will permanently remove the time entry.",
  {
    projectId: z
      .string()
      .describe("The ID of the project the time entry belongs to."),
    timeEntryId: z
      .string()
      .describe("The ID of the time entry to delete."),
  },
  async (params: { projectId: string; timeEntryId: string }) => {
    const { projectId, timeEntryId } = params;
    const response = await deleteXeroTimeEntry(projectId, timeEntryId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error deleting time entry: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Successfully deleted time entry with ID: ${timeEntryId} from project: ${projectId}`,
        },
      ],
    };
  },
);

export default DeleteTimeEntryTool;
