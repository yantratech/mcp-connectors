import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

export async function createDeviceNote(
  deviceId: string,
  content: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const note = await client.createDeviceNote(deviceId, content);
    return { isError: false, result: note };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function updateDeviceNote(
  deviceId: string,
  noteId: string,
  content: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const note = await client.updateDeviceNote(deviceId, noteId, content);
    return { isError: false, result: note };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function deleteDeviceNote(
  deviceId: string,
  noteId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const result = await client.deleteDeviceNote(deviceId, noteId);
    return { isError: false, result: result ?? { success: true } };
  } catch (err) {
    return formatKandjiError(err);
  }
}
