import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

import type { Project } from "xero-node/dist/gen/model/projects/project.js";
import type { ProjectCreateOrUpdate } from "xero-node/dist/gen/model/projects/projectCreateOrUpdate.js";

interface CreateProjectInput {
  name: string;
  contactId?: string;
  estimateAmount?: number;
  deadlineUtc?: string;
}

export async function createXeroProject(
  input: CreateProjectInput,
): Promise<XeroClientResponse<Project>> {
  try {
    await xeroClient.authenticate();

    const projectCreateOrUpdate: ProjectCreateOrUpdate = {
      name: input.name,
      contactId: input.contactId,
      estimateAmount: input.estimateAmount,
      deadlineUtc: input.deadlineUtc ? new Date(input.deadlineUtc) : undefined,
    };

    const response = await xeroClient.projectApi.createProject(
      xeroClient.tenantId,
      projectCreateOrUpdate,
    );

    if (!response.body) {
      return {
        result: null,
        isError: true,
        error: "Failed to create project.",
      };
    }

    return {
      result: response.body,
      isError: false,
      error: null,
    };
  } catch (error) {
    return {
      result: null,
      isError: true,
      error: formatError(error),
    };
  }
}
