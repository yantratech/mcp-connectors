import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import {
  formatKandjiError,
  isLicenseGated,
} from "../helpers/format-kandji-error.js";

const LICENSE_GATED_NOTE =
  "Kandji EDR is not enabled for this tenant — the v1 and v2 threat endpoints both returned 404/401/403.";

export async function getThreats(
  filters: { deviceId?: string } = {},
  maxResults?: number,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const params: Record<string, string> = {};
    if (filters.deviceId) params.device_id = filters.deviceId;

    const threats = await client.getThreats(params, maxResults);
    return {
      isError: false,
      result: {
        count: threats.length,
        threats,
        license_gated: false,
        resolved_path: client.getResolvedThreatsPath(),
      },
    };
  } catch (err) {
    if (isLicenseGated(err)) {
      return {
        isError: false,
        result: {
          count: 0,
          threats: [],
          license_gated: true,
          note: LICENSE_GATED_NOTE,
        },
      };
    }
    return formatKandjiError(err);
  }
}

export async function getBehavioralDetections(
  filters: { deviceId?: string } = {},
  maxResults?: number,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const params: Record<string, string> = {};
    if (filters.deviceId) params.device_id = filters.deviceId;

    const events = await client.getBehavioralDetections(params, maxResults);
    return {
      isError: false,
      result: {
        count: events.length,
        events,
        license_gated: false,
        resolved_path: client.getResolvedBehavioralPath(),
      },
    };
  } catch (err) {
    if (isLicenseGated(err)) {
      return {
        isError: false,
        result: {
          count: 0,
          events: [],
          license_gated: true,
          note: LICENSE_GATED_NOTE,
        },
      };
    }
    return formatKandjiError(err);
  }
}
