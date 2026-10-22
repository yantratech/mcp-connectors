import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

export async function listDeviceNotes(
  deviceId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const notes = await client.getDeviceNotes(deviceId);
    return {
      isError: false,
      result: {
        count: notes.length,
        ...(notes.length === 0
          ? {
              note: "Upstream returns HTTP 200 with an empty notes list for device IDs that do not exist — an empty result does NOT confirm the device exists. Verify the ID with get_device, which 404s loudly on unknown IDs.",
            }
          : {}),
        notes,
      },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}
