import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

type LibraryKind =
  | "custom-apps"
  | "custom-profiles"
  | "custom-scripts"
  | "ipa-apps";

function logDelete(kind: LibraryKind, libraryItemId: string): void {
  process.stderr.write(
    `[kandji-mcp] delete-${kind}: id=${libraryItemId} at=${new Date().toISOString()}\n`,
  );
}

function asResponse<T>(result: T): KandjiClientResponse<T> {
  return { isError: false, result };
}

function asError(err: unknown): KandjiClientResponse<never> {
  return formatKandjiError(err);
}

// ── Custom Apps ──

export async function createCustomApp(
  payload: Record<string, unknown>,
): Promise<KandjiClientResponse<unknown>> {
  try {
    return asResponse(await getKandjiClient().createCustomApp(payload));
  } catch (err) {
    return asError(err);
  }
}

export async function updateCustomApp(
  libraryItemId: string,
  payload: Record<string, unknown>,
): Promise<KandjiClientResponse<unknown>> {
  try {
    return asResponse(
      await getKandjiClient().updateCustomApp(libraryItemId, payload),
    );
  } catch (err) {
    return asError(err);
  }
}

export async function deleteCustomApp(
  libraryItemId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const result = await getKandjiClient().deleteCustomApp(libraryItemId);
    logDelete("custom-apps", libraryItemId);
    return asResponse(result ?? { deleted: true, library_item_id: libraryItemId });
  } catch (err) {
    return asError(err);
  }
}

export async function requestCustomAppUpload(
  name: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    return asResponse(await getKandjiClient().requestCustomAppUpload(name));
  } catch (err) {
    return asError(err);
  }
}

// ── Custom Profiles ──

export async function createCustomProfile(payload: {
  name: string;
  mobileconfig: string;
  runs_on_mac?: boolean;
  runs_on_iphone?: boolean;
  runs_on_ipad?: boolean;
  runs_on_tv?: boolean;
  runs_on_vision?: boolean;
}): Promise<KandjiClientResponse<unknown>> {
  try {
    return asResponse(await getKandjiClient().createCustomProfile(payload));
  } catch (err) {
    return asError(err);
  }
}

export async function updateCustomProfile(
  libraryItemId: string,
  payload: Record<string, unknown>,
): Promise<KandjiClientResponse<unknown>> {
  try {
    return asResponse(
      await getKandjiClient().updateCustomProfile(libraryItemId, payload),
    );
  } catch (err) {
    return asError(err);
  }
}

export async function deleteCustomProfile(
  libraryItemId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const result = await getKandjiClient().deleteCustomProfile(libraryItemId);
    logDelete("custom-profiles", libraryItemId);
    return asResponse(result ?? { deleted: true, library_item_id: libraryItemId });
  } catch (err) {
    return asError(err);
  }
}

// ── Custom Scripts ──

export async function createCustomScript(
  payload: Record<string, unknown>,
): Promise<KandjiClientResponse<unknown>> {
  try {
    return asResponse(await getKandjiClient().createCustomScript(payload));
  } catch (err) {
    return asError(err);
  }
}

export async function updateCustomScript(
  libraryItemId: string,
  payload: Record<string, unknown>,
): Promise<KandjiClientResponse<unknown>> {
  try {
    return asResponse(
      await getKandjiClient().updateCustomScript(libraryItemId, payload),
    );
  } catch (err) {
    return asError(err);
  }
}

export async function deleteCustomScript(
  libraryItemId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const result = await getKandjiClient().deleteCustomScript(libraryItemId);
    logDelete("custom-scripts", libraryItemId);
    return asResponse(result ?? { deleted: true, library_item_id: libraryItemId });
  } catch (err) {
    return asError(err);
  }
}

// ── In-House (IPA) Apps ──

export async function createInHouseApp(
  payload: Record<string, unknown>,
): Promise<KandjiClientResponse<unknown>> {
  try {
    return asResponse(await getKandjiClient().createInHouseApp(payload));
  } catch (err) {
    return asError(err);
  }
}

export async function updateInHouseApp(
  libraryItemId: string,
  payload: Record<string, unknown>,
): Promise<KandjiClientResponse<unknown>> {
  try {
    return asResponse(
      await getKandjiClient().updateInHouseApp(libraryItemId, payload),
    );
  } catch (err) {
    return asError(err);
  }
}

export async function deleteInHouseApp(
  libraryItemId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const result = await getKandjiClient().deleteInHouseApp(libraryItemId);
    logDelete("ipa-apps", libraryItemId);
    return asResponse(result ?? { deleted: true, library_item_id: libraryItemId });
  } catch (err) {
    return asError(err);
  }
}

export async function requestInHouseAppUpload(
  filename: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    return asResponse(await getKandjiClient().requestInHouseAppUpload(filename));
  } catch (err) {
    return asError(err);
  }
}
