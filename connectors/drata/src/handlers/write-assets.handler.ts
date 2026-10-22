import { getDrataClient } from "../clients/drata-client.js";
import { mapDrataError } from "../helpers/error-mapping.js";
import type { DrataClientResponse } from "../types/drata-client-response.js";

export async function createAsset(
  body: Record<string, unknown>,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const asset = await client.createAsset(body);
    return { isError: false, result: asset };
  } catch (err) {
    return mapDrataError(err);
  }
}
