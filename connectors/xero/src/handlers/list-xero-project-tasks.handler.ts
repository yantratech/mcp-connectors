import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

import type { Task } from "xero-node/dist/gen/model/projects/task.js";

export async function listXeroProjectTasks(
  projectId: string,
  page?: number,
  pageSize?: number,
): Promise<XeroClientResponse<Task[]>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.projectApi.getTasks(
      xeroClient.tenantId,
      projectId,
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
