import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

import type { TimeEntry } from "xero-node/dist/gen/model/projects/timeEntry.js";

export async function getXeroTimeEntry(
  projectId: string,
  timeEntryId: string,
): Promise<XeroClientResponse<TimeEntry>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.projectApi.getTimeEntry(
      xeroClient.tenantId,
      projectId,
      timeEntryId,
    );

    if (!response.body) {
      return {
        result: null,
        isError: true,
        error: "Time entry not found.",
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
