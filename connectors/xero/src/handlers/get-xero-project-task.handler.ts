import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

import type { Task } from "xero-node/dist/gen/model/projects/task.js";

export async function getXeroProjectTask(
  projectId: string,
  taskId: string,
): Promise<XeroClientResponse<Task>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.projectApi.getTask(
      xeroClient.tenantId,
      projectId,
      taskId,
    );

    if (!response.body) {
      return {
        result: null,
        isError: true,
        error: "Task not found.",
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
