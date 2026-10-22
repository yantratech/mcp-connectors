import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

/**
 * Default cap on activity entries per call. Entries average ~770 JSON chars
 * and even a newly enrolled device accumulates dozens, so uncapped history
 * walks on long-lived devices produce very large payloads. The envelope's
 * own `count` supplies the full universe total when the cap truncates.
 */
const DEFAULT_ACTIVITY_MAX_RESULTS = 50;

export async function getDeviceActivity(
  deviceId: string,
  maxResults?: number,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const cap = maxResults ?? DEFAULT_ACTIVITY_MAX_RESULTS;
    const { activity, total } = await client.getDeviceActivity(deviceId, cap);
    const truncated = total !== null && activity.length < total;
    return {
      isError: false,
      result: {
        returned: activity.length,
        total_available: total,
        truncated,
        ...(maxResults === undefined ? { default_cap_applied: cap } : {}),
        ...(truncated
          ? {
              note: `Showing first ${activity.length} of ${total} activity entries — raise max_results to fetch more.`,
            }
          : {}),
        ...(activity.length === 0
          ? {
              note: "Upstream returns HTTP 200 with an empty activity list for device IDs that do not exist — an empty result does NOT confirm the device exists. Verify the ID with get_device, which 404s loudly on unknown IDs.",
            }
          : {}),
        activity,
      },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}
