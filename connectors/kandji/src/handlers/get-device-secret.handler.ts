import {
  getKandjiClient,
  type DeviceSecretKind,
} from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

export async function getDeviceSecret(
  deviceId: string,
  kind: DeviceSecretKind,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const secret = await client.getDeviceSecret(deviceId, kind);
    // Emit an audit trail line — accessing recovery secrets is sensitive.
    // Written to stderr so stdout remains clean JSON-RPC for the MCP transport.
    process.stderr.write(
      `[kandji-mcp] device secret accessed: device=${deviceId} kind=${kind} at=${new Date().toISOString()}\n`,
    );
    return { isError: false, result: secret };
  } catch (err) {
    return formatKandjiError(err);
  }
}
