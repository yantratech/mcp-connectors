import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function deleteXeroTimeEntry(
  projectId: string,
  timeEntryId: string,
): Promise<XeroClientResponse<boolean>> {
  try {
    await xeroClient.authenticate();

    await xeroClient.projectApi.deleteTimeEntry(
      xeroClient.tenantId,
      projectId,
      timeEntryId,
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
