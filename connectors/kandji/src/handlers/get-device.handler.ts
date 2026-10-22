import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

export async function getDevice(
  deviceId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const device = await client.getDevice(deviceId);
    return { isError: false, result: device };
  } catch (err) {
    return formatKandjiError(err);
  }
}
