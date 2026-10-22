import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

export async function createBlueprint(
  payload: Record<string, unknown>,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const result = await client.createBlueprint(payload);
    return { isError: false, result };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function updateBlueprint(
  blueprintId: string,
  payload: Record<string, unknown>,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const result = await client.updateBlueprint(blueprintId, payload);
    return { isError: false, result };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function deleteBlueprint(
  blueprintId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const result = await client.deleteBlueprint(blueprintId);
    process.stderr.write(
      `[kandji-mcp] delete_blueprint executed: blueprint=${blueprintId} at=${new Date().toISOString()}\n`,
    );
    return {
      isError: false,
      result: result ?? { deleted: true, blueprint_id: blueprintId },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function assignLibraryItemToBlueprint(
  blueprintId: string,
  libraryItemId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const result = await client.assignLibraryItemToBlueprint(
      blueprintId,
      libraryItemId,
    );
    return { isError: false, result };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function removeLibraryItemFromBlueprint(
  blueprintId: string,
  libraryItemId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const result = await client.removeLibraryItemFromBlueprint(
      blueprintId,
      libraryItemId,
    );
    return { isError: false, result };
  } catch (err) {
    return formatKandjiError(err);
  }
}
