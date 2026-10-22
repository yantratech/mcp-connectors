import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

import type { TimeEntry } from "xero-node/dist/gen/model/projects/timeEntry.js";

export async function listXeroTimeEntries(
  projectId: string,
  userId?: string,
  taskId?: string,
  page?: number,
  pageSize?: number,
  dateAfterUtc?: string,
  dateBeforeUtc?: string,
): Promise<XeroClientResponse<TimeEntry[]>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.projectApi.getTimeEntries(
      xeroClient.tenantId,
      projectId,
      userId,
      taskId,
      undefined, // invoiceId
      undefined, // contactId
      page,
      pageSize,
      undefined, // states
      undefined, // isChargeable
      dateAfterUtc ? new Date(dateAfterUtc) : undefined,
      dateBeforeUtc ? new Date(dateBeforeUtc) : undefined,
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
