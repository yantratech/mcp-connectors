import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

import type { Project } from "xero-node/dist/gen/model/projects/project.js";

export async function getXeroProject(
  projectId: string,
): Promise<XeroClientResponse<Project>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.projectApi.getProject(
      xeroClient.tenantId,
      projectId,
    );

    if (!response.body) {
      return {
        result: null,
        isError: true,
        error: "Project not found.",
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
