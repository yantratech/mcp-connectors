import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

export async function getDeviceNote(
  deviceId: string,
  noteId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const note = await client.getDeviceNote(deviceId, noteId);
    return { isError: false, result: note };
  } catch (err) {
    return formatKandjiError(err);
  }
}
