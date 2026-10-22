import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

export async function updateDevice(
  deviceId: string,
  payload: Record<string, unknown>,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const result = await client.updateDevice(deviceId, payload);
    return { isError: false, result: result ?? { success: true } };
  } catch (err) {
    return formatKandjiError(err);
  }
}
