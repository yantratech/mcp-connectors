import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

import type { Project } from "xero-node/dist/gen/model/projects/project.js";

export async function listXeroProjects(
  contactId?: string,
  states?: string,
  page?: number,
  pageSize?: number,
): Promise<XeroClientResponse<Project[]>> {
  try {
    await xeroClient.authenticate();

    const statesArray = states ? states.split(",").map((s) => s.trim()) : undefined;

    const response = await xeroClient.projectApi.getProjects(
      xeroClient.tenantId,
      undefined, // projectIds
      contactId,
      statesArray as undefined,
      page,
      pageSize,
    );

    return {
      result: response.body.items ?? [],
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
