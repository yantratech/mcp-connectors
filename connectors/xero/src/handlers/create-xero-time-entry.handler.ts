import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

import type { TimeEntry } from "xero-node/dist/gen/model/projects/timeEntry.js";
import type { TimeEntryCreateOrUpdate } from "xero-node/dist/gen/model/projects/timeEntryCreateOrUpdate.js";

interface CreateTimeEntryInput {
  projectId: string;
  userId: string;
  taskId: string;
  dateUtc: string;
  duration: number;
  description?: string;
}

export async function createXeroTimeEntry(
  input: CreateTimeEntryInput,
): Promise<XeroClientResponse<TimeEntry>> {
  try {
    await xeroClient.authenticate();

    const timeEntryCreateOrUpdate: TimeEntryCreateOrUpdate = {
      userId: input.userId,
      taskId: input.taskId,
      dateUtc: new Date(input.dateUtc),
      duration: input.duration,
      description: input.description,
    };

    const response = await xeroClient.projectApi.createTimeEntry(
      xeroClient.tenantId,
      input.projectId,
      timeEntryCreateOrUpdate,
    );

    if (!response.body) {
      return {
        result: null,
        isError: true,
        error: "Failed to create time entry.",
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
