import { xeroClient } from "../clients/xero-client.js";
import { Item } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function getXeroItem(
  itemId: string,
): Promise<XeroClientResponse<Item>> {
  try {
    await xeroClient.authenticate();

    const response = await xeroClient.accountingApi.getItem(
      xeroClient.tenantId,
      itemId,
      undefined, // unitdp
      getClientHeaders(),
    );

    const item = response.body.items?.[0];

    if (!item) {
      return {
        result: null,
        isError: true,
        error: "Item not found.",
      };
    }

    return {
      result: item,
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
