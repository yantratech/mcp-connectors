import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

export async function listDevices(
  filters: {
    platform?: string;
    blueprintId?: string;
    serialNumber?: string;
    assetTag?: string;
    userEmail?: string;
    filevaultEnabled?: boolean;
  } = {},
  maxResults?: number,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const params: Record<string, string> = {};
    if (filters.platform) params.platform = filters.platform;
    if (filters.blueprintId) params.blueprint_id = filters.blueprintId;
    if (filters.serialNumber) params.serial_number = filters.serialNumber;
    if (filters.assetTag) params.asset_tag = filters.assetTag;
    if (filters.userEmail) params.user_email = filters.userEmail;
    if (filters.filevaultEnabled !== undefined)
      params.filevault_enabled = String(filters.filevaultEnabled);

    // Probe one row past the cap so a capped result can say that more
    // devices exist — otherwise {count: N} from a capped call would be
    // byte-identical to a genuine N-device fleet.
    const fetched = await client.listDevices(
      params,
      maxResults === undefined ? undefined : maxResults + 1,
    );
    const truncated = maxResults !== undefined && fetched.length > maxResults;
    const devices = truncated ? fetched.slice(0, maxResults) : fetched;
    return {
      isError: false,
      result: {
        count: devices.length,
        ...(truncated
          ? {
              truncated: true,
              note: `More devices exist beyond the max_results cap of ${maxResults} — this count is the capped page size, NOT the fleet size. Raise max_results or add filters.`,
            }
          : {}),
        devices,
      },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}
