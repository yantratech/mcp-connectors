import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

import type { ProjectUser } from "xero-node/dist/gen/model/projects/projectUser.js";

export async function listXeroProjectUsers(
  page?: number,
  pageSize?: number,
): Promise<XeroClientResponse<ProjectUser[]>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.projectApi.getProjectUsers(
      xeroClient.tenantId,
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
