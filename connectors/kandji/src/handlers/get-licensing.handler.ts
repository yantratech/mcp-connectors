import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

export async function getLicensing(): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const licensing = await client.getLicensing();
    return { isError: false, result: licensing };
  } catch (err) {
    return formatKandjiError(err);
  }
}
