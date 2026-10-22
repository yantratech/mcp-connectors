import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

export async function testConnection(): Promise<
  KandjiClientResponse<{ ok: boolean; message: string }>
> {
  try {
    const client = getKandjiClient();
    const result = await client.testConnection();
    return {
      isError: false,
      result: {
        ok: result.ok,
        message: `Connected to Kandji. API returned ${result.deviceCount} device(s) in test query.`,
      },
    };
  } catch (err) {
    // Surface the two env vars the operator must get right — test_connection
    // is the diagnostic tool, so its failure should name what to check.
    const formatted = formatKandjiError(err);
    return {
      ...formatted,
      hint:
        formatted.hint ??
        "Verify KANDJI_API_TOKEN (a valid API token) and KANDJI_BASE_URL (e.g. https://yourcompany.api.kandji.io/api/v1) are set correctly.",
    };
  }
}
