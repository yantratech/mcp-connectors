import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

export async function createTag(
  name: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const tag = await client.createTag(name);
    return { isError: false, result: tag };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function updateTag(
  tagId: string,
  name: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const tag = await client.updateTag(tagId, name);
    return { isError: false, result: tag };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function deleteTag(
  tagId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const result = await client.deleteTag(tagId);
    return { isError: false, result: result ?? { success: true } };
  } catch (err) {
    return formatKandjiError(err);
  }
}
