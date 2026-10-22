import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

import type { ProjectCreateOrUpdate } from "xero-node/dist/gen/model/projects/projectCreateOrUpdate.js";

interface UpdateProjectInput {
  projectId: string;
  name: string;
  contactId?: string;
  estimateAmount?: number;
  deadlineUtc?: string;
}

export async function updateXeroProject(
  input: UpdateProjectInput,
): Promise<XeroClientResponse<boolean>> {
  try {
    await xeroClient.authenticate();

    const projectCreateOrUpdate: ProjectCreateOrUpdate = {
      name: input.name,
      contactId: input.contactId,
      estimateAmount: input.estimateAmount,
      deadlineUtc: input.deadlineUtc ? new Date(input.deadlineUtc) : undefined,
    };

    await xeroClient.projectApi.updateProject(
      xeroClient.tenantId,
      input.projectId,
      projectCreateOrUpdate,
    );

    return {
      result: true,
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
