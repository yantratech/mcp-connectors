import { getKandjiClient, KandjiApiError } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

/**
 * Tenants without Blueprint Routing configured 404 with the body
 * "Blueprint routing configuration not found" — that's a normal "feature
 * not in use" state, not an error. Surface it as { configured: false } so
 * compliance audits don't get spurious red flags.
 */
export async function getBlueprintRouting(): Promise<
  KandjiClientResponse<unknown>
> {
  try {
    const client = getKandjiClient();
    const routing = await client.getBlueprintRouting();
    const merged =
      routing && typeof routing === "object" && !Array.isArray(routing)
        ? { configured: true, ...(routing as Record<string, unknown>) }
        : { configured: true, value: routing };
    return { isError: false, result: merged };
  } catch (err) {
    if (err instanceof KandjiApiError && err.status === 404) {
      return {
        isError: false,
        result: { configured: false, rules: [] },
      };
    }
    return formatKandjiError(err);
  }
}

export async function getBlueprintRoutingActivity(
  maxResults?: number,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const activity = await client.getBlueprintRoutingActivity(maxResults);
    return {
      isError: false,
      result: { configured: true, count: activity.length, activity },
    };
  } catch (err) {
    if (err instanceof KandjiApiError && err.status === 404) {
      return {
        isError: false,
        result: { configured: false, count: 0, activity: [] },
      };
    }
    return formatKandjiError(err);
  }
}
