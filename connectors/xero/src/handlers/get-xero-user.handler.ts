import { xeroClient } from "../clients/xero-client.js";
import { User } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function getXeroUser(
  userId: string,
): Promise<XeroClientResponse<User>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getUser(
      xeroClient.tenantId,
      userId,
      getClientHeaders(),
    );

    const user = response.body.users?.[0];

    if (!user) {
      return {
        result: null,
        isError: true,
        error: "User not found.",
      };
    }

    return {
      result: user,
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
