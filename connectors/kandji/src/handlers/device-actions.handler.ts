import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

/**
 * Generic POST /devices/{id}/action/<action> wrapper for the destructive,
 * disruptive, and lost-mode device actions. Each accepted call is logged to stderr
 * with the action verb so destructive activity has an audit trail at the
 * MCP boundary even when the upstream tool log is unavailable.
 *
 * `signal` is the MCP request's abort signal: once the client cancels the
 * call or times it out, the action is no longer sent.
 */
export async function triggerDeviceAction(
  deviceId: string,
  action: string,
  payload?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const result = await client.triggerDeviceAction(
      deviceId,
      action,
      payload,
      signal,
    );
    process.stderr.write(
      `[kandji-mcp] device-action queued: device=${deviceId} action=${action} at=${new Date().toISOString()}\n`,
    );
    return {
      isError: false,
      result: result ?? { queued: true, action },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}
