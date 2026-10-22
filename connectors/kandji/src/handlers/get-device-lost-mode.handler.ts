import { getKandjiClient, KandjiApiError } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

/**
 * Devices not currently in Lost Mode 400 with body
 * "Device is not in lost mode." — surface that as a clean
 * { lost_mode_enabled: false } rather than propagating the error.
 */
export async function getDeviceLostMode(
  deviceId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const state = await client.getDeviceLostMode(deviceId);
    const merged =
      state && typeof state === "object" && !Array.isArray(state)
        ? { lost_mode_enabled: true, ...(state as Record<string, unknown>) }
        : { lost_mode_enabled: true, value: state };
    return { isError: false, result: merged };
  } catch (err) {
    if (
      err instanceof KandjiApiError &&
      err.status === 400 &&
      /not in lost mode/i.test(err.bodyText)
    ) {
      return { isError: false, result: { lost_mode_enabled: false } };
    }
    return formatKandjiError(err);
  }
}
