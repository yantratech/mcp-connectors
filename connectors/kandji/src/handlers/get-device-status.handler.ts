import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

export async function getDeviceStatus(
  deviceId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const status = await client.getDeviceStatus(deviceId);
    // Kandji mixes status vocabularies within one response (lowercase
    // 'success' and uppercase 'PASS' both mean compliant, alongside 'PENDING'
    // and 'ERROR') — lead with a warning so consumers don't filter on a
    // single literal.
    if (status && typeof status === "object" && !Array.isArray(status)) {
      return {
        isError: false,
        result: {
          note: "Status values mix vocabularies upstream: library_items use both lowercase 'success' and uppercase 'PASS' for compliant items (plus 'PENDING'/'ERROR'/'FAIL'). Compare case-insensitively and treat success and PASS as equivalent — never filter on a single literal.",
          ...(status as Record<string, unknown>),
        },
      };
    }
    return { isError: false, result: status };
  } catch (err) {
    return formatKandjiError(err);
  }
}
