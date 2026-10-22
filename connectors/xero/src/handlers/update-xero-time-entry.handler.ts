import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

import type { TimeEntryCreateOrUpdate } from "xero-node/dist/gen/model/projects/timeEntryCreateOrUpdate.js";

interface UpdateTimeEntryInput {
  projectId: string;
  timeEntryId: string;
  userId: string;
  taskId: string;
  dateUtc: string;
  duration: number;
  description?: string;
}

export async function updateXeroTimeEntry(
  input: UpdateTimeEntryInput,
): Promise<XeroClientResponse<boolean>> {
  try {
    await xeroClient.authenticate();

    const timeEntryCreateOrUpdate: TimeEntryCreateOrUpdate = {
      userId: input.userId,
      taskId: input.taskId,
      dateUtc: new Date(input.dateUtc),
      duration: input.duration,
      description: input.description,
    };

    await xeroClient.projectApi.updateTimeEntry(
      xeroClient.tenantId,
      input.projectId,
      input.timeEntryId,
      timeEntryCreateOrUpdate,
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
