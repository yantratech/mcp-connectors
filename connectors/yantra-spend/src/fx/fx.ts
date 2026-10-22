/**
 * USD→GBP conversion. USD remains the canonical figure on every CostLine; this
 * module is invoked only when the caller passes currency="GBP".
 *
 * Strategy:
 *   1. If FX_GBP_PER_USD_OVERRIDE is set, use it (no HTTP).
 *   2. Otherwise GET FX_PROVIDER_URL (default: Frankfurter, see below) and
 *      parse `rates.GBP`. Cached in-process for FX_CACHE_TTL_SECONDS
 *      (default 60s).
 *
 * `fetcher` is dependency-injected so tests can stub the HTTP without a
 * library mock.
 */

// Frankfurter is ECB-backed, key-free, and stable. The .app domain now
// 301-redirects to .dev/v1/* — pinning to the post-redirect URL avoids one
// round trip per cold call. exchangerate.host went to a paid model in 2024.
// Override per-deploy via FX_PROVIDER_URL when needed.
const DEFAULT_PROVIDER_URL =
  "https://api.frankfurter.dev/v1/latest?from=USD&to=GBP";
const DEFAULT_CACHE_TTL_SECONDS = 60;

type Fetcher = (url: string) => Promise<Response>;

interface CacheEntry {
  rate: number;
  fetchedAtMs: number;
}

let cache: CacheEntry | null = null;

export function _resetFxCacheForTests(): void {
  cache = null;
}

interface FxOptions {
  fetcher?: Fetcher;
  /** Override the cache TTL for this call only — used by tests. */
  cacheTtlSeconds?: number;
}

export async function gbpPerUsd(opts: FxOptions = {}): Promise<number> {
  const override = process.env.FX_GBP_PER_USD_OVERRIDE;
  if (override !== undefined && override !== "") {
    const parsed = Number(override);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(
        `FX_GBP_PER_USD_OVERRIDE is not a positive number: ${override}`,
      );
    }
    return parsed;
  }

  const ttlSeconds =
    opts.cacheTtlSeconds ??
    Number(process.env.FX_CACHE_TTL_SECONDS ?? DEFAULT_CACHE_TTL_SECONDS);
  const now = Date.now();
  if (cache && now - cache.fetchedAtMs < ttlSeconds * 1000) {
    return cache.rate;
  }

  const url = process.env.FX_PROVIDER_URL ?? DEFAULT_PROVIDER_URL;
  const fetcher: Fetcher = opts.fetcher ?? fetch;
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(
      `FX provider returned ${response.status} from ${stripQuery(url)}`,
    );
  }
  const body = (await response.json()) as { rates?: { GBP?: number } };
  const rate = body.rates?.GBP;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(
      `FX provider response missing a positive rates.GBP value at ${stripQuery(url)}`,
    );
  }
  cache = { rate, fetchedAtMs: now };
  return rate;
}

export function usdToGbp(amountUsd: number, rate: number): number {
  return roundCurrency(amountUsd * rate);
}

export function roundCurrency(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function stripQuery(url: string): string {
  const i = url.indexOf("?");
  return i >= 0 ? url.slice(0, i) : url;
}
