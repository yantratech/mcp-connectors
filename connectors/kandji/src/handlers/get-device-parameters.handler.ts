import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

export async function getDeviceParameters(
  deviceId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const parameters = await client.getDeviceParameters(deviceId);
    return {
      isError: false,
      result: { count: parameters.length, parameters },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}
