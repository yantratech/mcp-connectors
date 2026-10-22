import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

export async function getUser(
  userId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const user = await client.getUser(userId);
    return { isError: false, result: user };
  } catch (err) {
    return formatKandjiError(err);
  }
}
