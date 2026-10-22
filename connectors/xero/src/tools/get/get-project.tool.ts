import { z } from "zod";
import { getXeroProject } from "../../handlers/get-xero-project.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const GetProjectTool = CreateXeroTool(
  "get_project",
  "Get a specific project by ID from Xero. \
  Use this to see full details including estimates, deadlines, and totals.",
  {
    projectId: z
      .string()
      .describe(
        "The ID of the project to retrieve. Can be obtained from list_projects.",
      ),
  },
  async ({ projectId }) => {
    const response = await getXeroProject(projectId);

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error getting project: ${response.error}`,
          },
        ],
      };
    }

    const project = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Project details:",
            `Project ID: ${project.projectId}`,
            `Name: ${project.name}`,
            project.contactId ? `Contact ID: ${project.contactId}` : null,
            project.status ? `Status: ${project.status}` : null,
            project.estimateAmount?.value !== undefined
              ? `Estimate Amount: ${project.estimateAmount.value}`
              : null,
            project.deadlineUtc
              ? `Deadline: ${project.deadlineUtc}`
              : null,
            project.totalTaskAmount?.value !== undefined
              ? `Total Task Amount: ${project.totalTaskAmount.value}`
              : null,
            project.totalInvoiced?.value !== undefined
              ? `Total Invoiced: ${project.totalInvoiced.value}`
              : null,
            project.totalToBeInvoiced?.value !== undefined
              ? `Total To Be Invoiced: ${project.totalToBeInvoiced.value}`
              : null,
            project.minutesLogged !== undefined
              ? `Minutes Logged: ${project.minutesLogged}`
              : null,
            project.minutesToBeInvoiced !== undefined
              ? `Minutes To Be Invoiced: ${project.minutesToBeInvoiced}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default GetProjectTool;
