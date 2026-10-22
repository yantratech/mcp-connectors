import { z } from "zod";
import { updateXeroProject } from "../../handlers/update-xero-project.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const UpdateProjectTool = CreateXeroTool(
  "update_project",
  "Update an existing project in Xero. The project name is required by the API. \
  Use get_project to retrieve current values before updating.",
  {
    projectId: z
      .string()
      .describe(
        "The ID of the project to update. Can be obtained from list_projects.",
      ),
    name: z
      .string()
      .describe("The name of the project (required by the API)."),
    contactId: z
      .string()
      .describe("The ID of the contact to associate with the project.")
      .optional(),
    estimateAmount: z
      .number()
      .describe("The estimated amount for the project.")
      .optional(),
    deadlineUtc: z
      .string()
      .describe("The project deadline in ISO 8601 date format (e.g. '2024-12-31').")
      .optional(),
  },
  async ({ projectId, name, contactId, estimateAmount, deadlineUtc }) => {
    const result = await updateXeroProject({
      projectId,
      name,
      contactId,
      estimateAmount,
      deadlineUtc,
    });

    if (result.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error updating project: ${result.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Successfully updated project with ID: ${projectId}`,
        },
      ],
    };
  },
);

export default UpdateProjectTool;
