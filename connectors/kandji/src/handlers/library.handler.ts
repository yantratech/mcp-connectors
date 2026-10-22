import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

/**
 * Convention for list-* handlers:
 *   { count, <domain_key> }
 *
 * Each list response carries exactly ONE array key — `results` for the four
 * generic library list-* tools, or the domain-specific key (statuses,
 * activity, categories, …) elsewhere. Never both: duplicating the array under
 * a second alias would double the serialized payload for no benefit.
 */

export async function listCustomApps(
  maxResults?: number,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const items = await client.listCustomApps({}, maxResults);
    return {
      isError: false,
      result: { count: items.length, results: items },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function getCustomApp(
  libraryItemId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const item = await client.getCustomApp(libraryItemId);
    return { isError: false, result: item };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function listInHouseApps(
  maxResults?: number,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const items = await client.listInHouseApps({}, maxResults);
    return {
      isError: false,
      result: { count: items.length, results: items },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function getInHouseApp(
  libraryItemId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const item = await client.getInHouseApp(libraryItemId);
    return { isError: false, result: item };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function listCustomProfiles(
  maxResults?: number,
  detail?: boolean,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const items = await client.listCustomProfiles({}, maxResults);
    // The list endpoint embeds the full mobileconfig XML (`profile`, ~4k
    // chars per item) in every row — dropped by default so a 50-profile
    // tenant doesn't return 200k chars of XML nobody asked for.
    const results = detail
      ? items
      : items.map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return item;
          }
          const rest = { ...(item as Record<string, unknown>) };
          delete rest.profile;
          return rest;
        });
    return {
      isError: false,
      result: {
        count: results.length,
        ...(!detail
          ? {
              profile_xml_omitted: true,
              note: "The full mobileconfig XML (`profile` field, ~4k chars per item) is omitted by default — pass detail: true to include it, or use get_custom_profile for a single item.",
            }
          : {}),
        results,
      },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function getCustomProfile(
  libraryItemId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const item = await client.getCustomProfile(libraryItemId);
    return { isError: false, result: item };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function listCustomScripts(
  maxResults?: number,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const items = await client.listCustomScripts({}, maxResults);
    return {
      isError: false,
      result: { count: items.length, results: items },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function getCustomScript(
  libraryItemId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const item = await client.getCustomScript(libraryItemId);
    return { isError: false, result: item };
  } catch (err) {
    return formatKandjiError(err);
  }
}

/**
 * Both library-item drill-down endpoints return HTTP 200 with an empty list
 * for library_item_ids that do not exist (confirmed live 2026-07-30), unlike
 * the get_custom_app/profile/script siblings which 404 loudly — so an empty
 * result carries an explicit warning instead of masquerading as "deployed to
 * zero devices / no history".
 */
const LIBRARY_ITEM_SILENT_EMPTY_NOTE =
  "Upstream returns HTTP 200 with an empty list for library item IDs that do not exist — an empty result does NOT confirm the item exists. Verify the ID via the list_custom_apps/list_custom_profiles/list_custom_scripts/list_in_house_apps tools (or get_custom_app/get_custom_profile/get_custom_script, which 404 loudly on unknown IDs).";

export async function getLibraryItemStatus(
  libraryItemId: string,
  maxResults?: number,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const statuses = await client.getLibraryItemStatus(
      libraryItemId,
      maxResults,
    );
    return {
      isError: false,
      result: {
        count: statuses.length,
        ...(statuses.length === 0
          ? { note: LIBRARY_ITEM_SILENT_EMPTY_NOTE }
          : {}),
        statuses,
      },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function getLibraryItemActivity(
  libraryItemId: string,
  maxResults?: number,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const activity = await client.getLibraryItemActivity(
      libraryItemId,
      maxResults,
    );
    return {
      isError: false,
      result: {
        count: activity.length,
        ...(activity.length === 0
          ? { note: LIBRARY_ITEM_SILENT_EMPTY_NOTE }
          : {}),
        activity,
      },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}

export async function listSelfServiceCategories(): Promise<
  KandjiClientResponse<unknown>
> {
  try {
    const client = getKandjiClient();
    const categories = await client.listSelfServiceCategories();
    return {
      isError: false,
      result: { count: categories.length, categories },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}
