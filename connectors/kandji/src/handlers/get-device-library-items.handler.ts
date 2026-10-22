import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

export async function getDeviceLibraryItems(
  deviceId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const items = await client.getDeviceLibraryItems(deviceId);
    return {
      isError: false,
      result: { count: items.length, library_items: items },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}
