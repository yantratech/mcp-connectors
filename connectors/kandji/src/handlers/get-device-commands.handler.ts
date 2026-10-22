import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

export async function getDeviceCommands(
  deviceId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const commands = await client.getDeviceCommands(deviceId);
    return { isError: false, result: { count: commands.length, commands } };
  } catch (err) {
    return formatKandjiError(err);
  }
}
