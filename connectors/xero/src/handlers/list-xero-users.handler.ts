import { xeroClient } from "../clients/xero-client.js";
import { User } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function listXeroUsers(
  where?: string,
  order?: string,
): Promise<XeroClientResponse<User[]>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getUsers(
      xeroClient.tenantId,
      undefined, // ifModifiedSince
      where,
      order,
      getClientHeaders(),
    );

    return {
      result: response.body.users ?? [],
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
