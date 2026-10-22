import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function deleteXeroProjectTask(
  projectId: string,
  taskId: string,
): Promise<XeroClientResponse<boolean>> {
  try {
    await xeroClient.authenticate();

    await xeroClient.projectApi.deleteTask(
      xeroClient.tenantId,
      projectId,
      taskId,
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
