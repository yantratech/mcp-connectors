import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

export async function triggerUpdateInventory(
  deviceId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const result = await client.triggerUpdateInventory(deviceId);
    process.stderr.write(
      `[kandji-mcp] update_inventory queued: device=${deviceId} at=${new Date().toISOString()}\n`,
    );
    return {
      isError: false,
      result: result ?? { queued: true, action: "updateinventory" },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function triggerDailyCheckin(
  deviceId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const result = await client.triggerDailyCheckin(deviceId);
    process.stderr.write(
      `[kandji-mcp] daily_checkin queued: device=${deviceId} at=${new Date().toISOString()}\n`,
    );
    return {
      isError: false,
      result: result ?? { queued: true, action: "dailycheckin" },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}
