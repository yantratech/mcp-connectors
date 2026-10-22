import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

export async function listTags(
  maxResults?: number,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const tags = await client.listTags(maxResults);
    return {
      isError: false,
      result: { count: tags.length, tags },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}
