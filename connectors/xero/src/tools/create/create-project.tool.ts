import { z } from "zod";
import { createXeroProject } from "../../handlers/create-xero-project.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const CreateProjectTool = CreateXeroTool(
  "create_project",
  "Create a new project in Xero. Projects track time and costs against a client or job. \
  A project name is required. Optionally link to a contact, set an estimate, and a deadline.",
  {
    name: z
      .string()
      .describe("The name of the project."),
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
  async ({ name, contactId, estimateAmount, deadlineUtc }) => {
    const result = await createXeroProject({
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
            text: `Error creating project: ${result.error}`,
          },
        ],
      };
    }

    const project = result.result;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Project created successfully:",
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
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  },
);

export default CreateProjectTool;
