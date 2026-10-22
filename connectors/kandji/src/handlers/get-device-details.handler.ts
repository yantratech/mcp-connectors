import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

/**
 * /devices/:id/details returns hardware_overview.model_name as the platform
 * label ("Mac", "iPad") instead of the marketing name ("MacBook Pro 14"
 * 2023"). The marketing name is on the lighter /devices/:id summary endpoint
 * under `model`. We fetch both in parallel and patch the marketing name in
 * when available, so callers don't have to know about this quirk.
 */
export async function getDeviceDetails(
  deviceId: string,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const [details, summary] = await Promise.all([
      client.getDeviceDetails(deviceId),
      client.getDevice(deviceId).catch(() => null),
    ]);

    const enriched = enrichModelName(details, summary);
    return { isError: false, result: enriched };
  } catch (err) {
    return formatKandjiError(err);
  }
}

function enrichModelName(details: unknown, summary: unknown): unknown {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return details;
  }
  const summaryObj =
    summary && typeof summary === "object" && !Array.isArray(summary)
      ? (summary as Record<string, unknown>)
      : null;
  const marketingModel =
    summaryObj && typeof summaryObj.model === "string" ? summaryObj.model : null;
  if (!marketingModel) return details;

  const detailsObj = details as Record<string, unknown>;
  const hardware = detailsObj.hardware_overview;
  if (!hardware || typeof hardware !== "object" || Array.isArray(hardware)) {
    return details;
  }

  const hardwareObj = hardware as Record<string, unknown>;
  const currentModelName = hardwareObj.model_name;
  // Only override when the existing value is a coarse platform label
  // (Mac/iPhone/iPad/AppleTV/VisionPro) — preserve any specific value the
  // API already populated.
  const isCoarseLabel =
    typeof currentModelName !== "string" ||
    /^(Mac|iPhone|iPad|AppleTV|Apple TV|VisionPro|Vision Pro)$/i.test(
      currentModelName,
    );
  if (!isCoarseLabel) return details;

  return {
    ...detailsObj,
    hardware_overview: {
      ...hardwareObj,
      model_name: marketingModel,
      model_name_raw: currentModelName,
    },
  };
}
