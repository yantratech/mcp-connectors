import { z } from "zod";
import { listXeroProjects } from "../../handlers/list-xero-projects.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListProjectsTool = CreateXeroTool(
  "list_projects",
  "List projects in Xero. Projects track time and costs against a client or job. \
  Can filter by contact and project status.",
  {
    contactId: z
      .string()
      .describe("Filter projects by contact ID.")
      .optional(),
    states: z
      .string()
      .describe("Comma-separated project states to filter by (e.g. 'INPROGRESS,CLOSED').")
      .optional(),
    page: z
      .number()
      .describe("The page number to retrieve, starting from 1.")
      .optional(),
    pageSize: z
      .number()
      .describe("The number of records per page. Default is 50.")
      .optional(),
  },
  async ({ contactId, states, page, pageSize }) => {
    const response = await listXeroProjects(
      contactId,
      states,
      page,
      pageSize,
    );

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing projects: ${response.error}`,
          },
        ],
      };
    }

    const projects = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${projects?.length || 0} projects:`,
        },
        ...(projects?.map((project) => ({
          type: "text" as const,
          text: [
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
            project.minutesLogged !== undefined
              ? `Minutes Logged: ${project.minutesLogged}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
);

export default ListProjectsTool;
