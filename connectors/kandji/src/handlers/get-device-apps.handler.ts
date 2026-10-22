import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

/**
 * Compact per-app projection. Full records average ~450 JSON chars each
 * (signature, dates, VPP flags, bundle_size...) and a Mac can carry well over
 * a hundred apps, so full records run to tens of thousands of characters per
 * device. These fields answer the common questions (what app, what version,
 * where from, where installed); `detail` opts back into full records. "name"
 * is included defensively for non-Mac (e.g. Windows agent) records that may
 * not use app_name.
 */
const APP_SUMMARY_FIELDS = [
  "app_name",
  "name",
  "version",
  "bundle_id",
  "source",
  "path",
] as const;

export async function getDeviceApps(
  deviceId: string,
  options: { maxResults?: number; detail?: boolean } = {},
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const all = await client.getDeviceApps(deviceId);
    const totalOnDevice = all.length;
    const truncated =
      options.maxResults !== undefined && all.length > options.maxResults;
    const capped = truncated ? all.slice(0, options.maxResults) : all;
    const apps = options.detail
      ? capped
      : capped.map((app) => {
          if (!app || typeof app !== "object" || Array.isArray(app)) return app;
          const record = app as Record<string, unknown>;
          const out: Record<string, unknown> = {};
          for (const field of APP_SUMMARY_FIELDS) {
            if (field in record) out[field] = record[field];
          }
          return out;
        });
    return {
      isError: false,
      result: {
        count: totalOnDevice,
        returned: apps.length,
        ...(truncated
          ? {
              truncated: true,
              note: `Showing first ${apps.length} of ${totalOnDevice} apps on this device — raise max_results for the rest.`,
            }
          : {}),
        ...(!options.detail
          ? {
              fields_returned: [...APP_SUMMARY_FIELDS],
              detail_note:
                "Rows are trimmed to key fields; pass detail: true for full records (bundle_size, signature, install dates, VPP flags, ...).",
            }
          : {}),
        apps,
      },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}
