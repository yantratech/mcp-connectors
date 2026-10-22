import { allSources } from "../sources/registry.js";
import { Source } from "../types/cost-line.js";
import { YantraSpendClientResponse } from "../types/client-response.js";
import { maskCredentials } from "../helpers/format-error.js";

export interface HealthArgs {
  /**
   * When true, hit each source's API with a cheap call (yesterday's window
   * for cost endpoints; for Cursor, a pageSize=1 POST to the same
   * filtered-usage-events endpoint cost queries use, over the last 24h) to
   * verify reachability beyond just env-var presence. Costs one round trip
   * per available source.
   */
  probe?: boolean;
}

/** Compact response when probe=false. */
export type SimpleHealth = Record<Source, boolean>;

/** Rich response when probe=true. */
export type RichHealth = Record<
  Source,
  {
    available: boolean;
    reachable: boolean;
    /**
     * For an unavailable source, "no credentials" ("unsupported" for GCP);
     * otherwise the probe's error, masked of credentials.
     */
    error?: string;
    /**
     * Env var name(s) to set to enable this source. Present only when the
     * source is unavailable and declares required env vars (GCP, which is not
     * supported, declares none, so this is omitted for it).
     */
    missing_env?: string[];
  }
>;

export async function healthCheck(
  args: HealthArgs = {},
): Promise<YantraSpendClientResponse<SimpleHealth | RichHealth>> {
  const sources = allSources();
  if (!args.probe) {
    const result = {} as SimpleHealth;
    for (const source of sources) {
      result[source.name] = source.isAvailable();
    }
    return { isError: false, result };
  }

  const result = {} as RichHealth;
  await Promise.all(
    sources.map(async (source) => {
      const available = source.isAvailable();
      // Sources may be plain test stubs without `requiredEnv`; coalesce.
      const requiredEnv = source.requiredEnv ?? [];
      if (!available) {
        result[source.name] = {
          available: false,
          reachable: false,
          // GCP is not supported (never available), which is not a
          // credentials problem: adding credentials would not enable it.
          error: source.name === "gcp" ? "unsupported" : "no credentials",
          // Tell the caller exactly what to set so "anthropic is false" maps
          // straight to an action. Omitted for GCP (unsupported; empty list).
          ...(requiredEnv.length > 0 ? { missing_env: [...requiredEnv] } : {}),
        };
        return;
      }
      try {
        const probeResult = await source.probe();
        result[source.name] = {
          available: true,
          reachable: probeResult.reachable,
          // Mask any credential-shaped substring the probe error might carry
          // (AWS/Azure SDK auth errors, echoed headers) before it reaches the
          // model — matches every other handler's formatError discipline.
          ...(probeResult.error
            ? { error: maskCredentials(probeResult.error) }
            : {}),
        };
      } catch (err) {
        result[source.name] = {
          available: true,
          reachable: false,
          error: maskCredentials(
            err instanceof Error ? err.message : String(err),
          ),
        };
      }
    }),
  );
  return { isError: false, result };
}
