import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

export async function requestPrismExport(
  category: string,
  args: Record<string, unknown> = {},
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const job = await client.requestPrismExport(category, args);
    return { isError: false, result: job };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function getPrismExport(
  exportId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const job = await client.getPrismExport(exportId);
    return { isError: false, result: job };
  } catch (err) {
    return formatKandjiError(err);
  }
}
