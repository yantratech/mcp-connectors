/**
 * Kandji (Iru) REST API client.
 * Uses Node built-in fetch — no external HTTP libraries.
 *
 * Kandji has MULTIPLE pagination envelopes across its API surface:
 *   - bare array                    → /devices, /devices/:id/notes, /self-service/categories
 *   - DRF {results[], count}        → /blueprints, /users, /tags, /library/*, /audit/events, /threat-details (v1)
 *   - Prism {data[], offset, limit, total, cursor}
 *                                   → /prism/:category
 *   - Vuln {results[], total, page, size}   (page/size pagination!)
 *                                   → /vulnerability-management/*
 *   - Doubly-nested {device_id, <key>: {results[]}}
 *                                   → /devices/:id/activity, /devices/:id/commands
 *
 * Rate limit: 10,000 requests per hour per customer, the only limit the API
 * reference (https://api-docs.iru.com/) documents. Headers: ratelimit-remaining,
 * ratelimit-reset.
 *
 * Every caller-influenced value interpolated into a request PATH goes through
 * `encodeId` (helpers/kandji-id.ts), which refuses separators, dot segments
 * and pre-encoded bytes before percent-encoding. Never interpolate an ID raw.
 */

import { setTimeout as delay } from "node:timers/promises";
import { encodeId } from "../helpers/kandji-id.js";

const DEFAULT_PAGE_SIZE = 300;
const RATE_LIMIT_BACKOFF_MS = 1000;
// Full body kept on the operator-facing `bodyText` field (stderr / diagnostics).
const MAX_ERROR_BODY_CHARS = 2000;
// Much tighter bound for the model-facing message: the upstream body is
// attacker-influenceable (verbose 4xx/5xx, proxied error pages) and is
// rendered into the agent's context, so cap it hard and delimit it as
// untrusted to blunt prompt-injection amplification.
const MODEL_FACING_BODY_CHARS = 280;

export type DeviceSecretKind =
  | "bypasscode"
  | "filevaultkey"
  | "unlockpin"
  | "recoverypassword";

type Envelope = "array" | "results" | "data" | "array-or-results";
type Paging = "limit-offset" | "page-size";

/**
 * Structured error for Kandji API failures so handlers can branch on status
 * (404 → "not configured", 401 → license-gated, etc.) without string-matching.
 */
export class KandjiApiError extends Error {
  /**
   * @param bodyText  The FULL (up to 2000-char) upstream body — operator-facing
   *                  only. Kept on the instance for stderr/diagnostics but
   *                  deliberately NOT spliced verbatim into `message`.
   *
   * `message` (which handlers echo to the model) leads with the HTTP status
   * and path and includes only a tightly-bounded, clearly-delimited slice of
   * the upstream body, since that body is attacker-influenceable.
   */
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly bodyText: string,
  ) {
    const snippet = truncate(bodyText, MODEL_FACING_BODY_CHARS);
    super(
      snippet
        ? `Kandji API error ${status} on ${path}: [upstream response — untrusted] ${snippet}`
        : `Kandji API error ${status} on ${path}`,
    );
    this.name = "KandjiApiError";
  }
}

/**
 * Thrown by `fetchWithVersionFallback` when both the v1 and v2 paths for a
 * licence-gated feature (EDR threat-details, behavioural-detections) return
 * 404 — i.e. the routes aren't exposed because the licence isn't enabled.
 * Handlers catch this and fold it into the documented graceful-degradation
 * shape: { count: 0, ..., license_gated: true }.
 */
export class KandjiLicenseGatedError extends Error {
  constructor(
    public readonly paths: readonly string[],
    public readonly feature: string,
  ) {
    super(
      `${feature} unavailable: ${paths.join(" and ")} returned 404 — likely missing Kandji licence for this feature`,
    );
    this.name = "KandjiLicenseGatedError";
  }
}

export const PRISM_CATEGORIES = [
  "apps",
  "filevault",
  "activation_lock",
  "application_firewall",
  "cellular",
  "certificates",
  "desktop_and_screensaver",
  "device_information",
  "gatekeeper_and_xprotect",
  "installed_profiles",
  "kernel_extensions",
  "launch_agents_and_daemons",
  "local_users",
  "startup_settings",
  "system_extensions",
  "transparency_database",
] as const;
export type PrismCategory = (typeof PRISM_CATEGORIES)[number];

function truncate(s: string, n = MAX_ERROR_BODY_CHARS): string {
  return s.length > n ? `${s.slice(0, n)}… [truncated ${s.length - n} chars]` : s;
}

/**
 * Validate and normalize KANDJI_BASE_URL.
 *
 * The base URL is concatenated with every request path and the long-lived API
 * token rides along in an `Authorization: Bearer` header, so a malformed value
 * (or a plain-`http://` typo) would silently transmit that token in cleartext
 * or to an unintended host. Parse it with `new URL()`, require https unless
 * the operator explicitly opts out via KANDJI_ALLOW_INSECURE=1, then strip any
 * trailing slashes so `${baseUrl}${path}` stays well-formed.
 */
function normalizeBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      `KANDJI_BASE_URL is not a valid URL: ${raw} (expected e.g. https://yourcompany.api.kandji.io/api/v1)`,
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      `KANDJI_BASE_URL must use http(s); got scheme '${parsed.protocol}'`,
    );
  }
  if (parsed.protocol !== "https:" && process.env.KANDJI_ALLOW_INSECURE !== "1") {
    throw new Error(
      "KANDJI_BASE_URL must use https (the Kandji API token is sent as a Bearer header on every request and would otherwise travel in cleartext). Set KANDJI_ALLOW_INSECURE=1 to override for local testing.",
    );
  }
  return raw.replace(/\/+$/, "");
}

/**
 * Paths that carry their own API version segment (e.g. `/v2/threat/...`) are
 * resolved against the API root, not against KANDJI_BASE_URL. The base URL is
 * documented to include the `/api/v1` suffix, so plain concatenation would
 * put these on the wire as `/api/v1/v2/...` — a 404 that the EDR fallback
 * would then report as "not licensed".
 */
const VERSIONED_PATH = /^\/v\d+\//;

/**
 * Derive the API root (e.g. `https://x.api.kandji.io/api`) from a normalized
 * KANDJI_BASE_URL by dropping a trailing `/v1`. A base URL without that
 * suffix is returned unchanged, so non-standard bases (proxies, test mocks)
 * keep their existing behaviour.
 */
export function apiRootFromBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/v1$/, "");
}

/**
 * Encode a payload as `application/x-www-form-urlencoded` with dotted-key
 * nesting, e.g. `{ enrollment_code: { is_active: true } }` becomes
 * `enrollment_code.is_active=true`. Required for endpoints whose Django
 * serializers expect form data (notably POST /blueprints — see
 * api-docs.iru.com). Booleans and numbers are stringified; undefined is
 * skipped; arrays repeat the same key. Only one level of nesting.
 */
export function toFormBody(payload: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  const append = (k: string, v: unknown) => {
    if (v === undefined || v === null) return;
    params.append(k, typeof v === "string" ? v : String(v));
  };
  for (const [key, val] of Object.entries(payload)) {
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) {
      for (const item of val) append(key, item);
    } else if (typeof val === "object") {
      for (const [subKey, subVal] of Object.entries(
        val as Record<string, unknown>,
      )) {
        if (Array.isArray(subVal)) {
          for (const item of subVal) append(`${key}.${subKey}`, item);
        } else {
          append(`${key}.${subKey}`, subVal);
        }
      }
    } else {
      append(key, val);
    }
  }
  return params;
}

export type MultipartFile = {
  filename: string;
  content: Buffer | string;
  contentType?: string;
};

/**
 * Build a `multipart/form-data` body. Used by endpoints that expect file
 * uploads — notably `/library/custom-profiles` (mobileconfig in a `file`
 * field) and the custom-app/in-house-app S3 step. Returns the raw body
 * Buffer + the matching Content-Type with the boundary embedded; callers
 * must use the returned content-type as-is.
 */
export function toMultipartBody(
  fields: Record<string, unknown>,
  files: Record<string, MultipartFile> = {},
): { body: Buffer; contentType: string } {
  const boundary =
    "----kandjimcp" + Math.random().toString(16).slice(2) + Date.now().toString(16);
  const CRLF = "\r\n";
  const parts: Buffer[] = [];

  const pushField = (name: string, value: unknown) => {
    if (value === undefined || value === null) return;
    parts.push(
      Buffer.from(
        `--${boundary}${CRLF}` +
          `Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}` +
          `${typeof value === "string" ? value : String(value)}${CRLF}`,
      ),
    );
  };

  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) pushField(k, item);
    } else {
      pushField(k, v);
    }
  }

  for (const [k, f] of Object.entries(files)) {
    const ct = f.contentType ?? "application/octet-stream";
    parts.push(
      Buffer.from(
        `--${boundary}${CRLF}` +
          `Content-Disposition: form-data; name="${k}"; filename="${f.filename}"${CRLF}` +
          `Content-Type: ${ct}${CRLF}${CRLF}`,
      ),
    );
    parts.push(
      typeof f.content === "string" ? Buffer.from(f.content, "utf8") : f.content,
    );
    parts.push(Buffer.from(CRLF));
  }

  parts.push(Buffer.from(`--${boundary}--${CRLF}`));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function extractItems<T>(body: unknown, envelope: Envelope): T[] {
  if (envelope === "array" || envelope === "array-or-results") {
    if (Array.isArray(body)) return body as T[];
    // "array-or-results" tolerates DRF-wrapped tenants: a non-array body
    // falls through to the `results` unwrap below. Plain "array" does not.
    if (envelope === "array") return [];
  }
  if (body && typeof body === "object") {
    const key = envelope === "data" ? "data" : "results";
    const arr = (body as Record<string, unknown>)[key];
    return Array.isArray(arr) ? (arr as T[]) : [];
  }
  return [];
}

class KandjiClientInstance {
  private apiToken: string;
  private baseUrl: string;
  private apiRoot: string;

  constructor() {
    const apiToken = process.env.KANDJI_API_TOKEN;
    const baseUrl = process.env.KANDJI_BASE_URL;

    if (!apiToken) {
      throw new Error("KANDJI_API_TOKEN environment variable is required");
    }
    if (!baseUrl) {
      throw new Error(
        "KANDJI_BASE_URL environment variable is required (e.g. https://yourcompany.api.kandji.io/api/v1)",
      );
    }

    this.apiToken = apiToken;
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.apiRoot = apiRootFromBaseUrl(this.baseUrl);
  }

  /**
   * Build the wire URL for a request path. Version-less paths hang off the
   * v1 base URL; paths that name their own version (`/v2/...`) hang off the
   * API root so they reach `/api/v2/...` rather than `/api/v1/v2/...`.
   */
  private urlFor(path: string): string {
    return VERSIONED_PATH.test(path)
      ? `${this.apiRoot}${path}`
      : `${this.baseUrl}${path}`;
  }

  private authHeaders(extra?: HeadersInit): HeadersInit {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  /**
   * Low-level fetch that handles auth, the 429 backoff-and-retry, and
   * propagates structured errors for non-2xx responses. Returns the raw
   * response body so callers can decide whether to JSON-parse — needed
   * because some Kandji endpoints (ADE public key) return PEM, not JSON.
   *
   * The body is read as raw bytes and ALSO exposed as `bytes` because at
   * least one endpoint (the OTA enrollment profile) serves a binary
   * CMS/PKCS#7 blob — decoding it through .text() irreversibly corrupts it
   * with UTF-8 replacement characters. `body` stays the UTF-8 decode for
   * JSON/PEM/error paths.
   */
  private async requestRaw(
    path: string,
    options: RequestInit = {},
  ): Promise<{ contentType: string | null; body: string; bytes: Buffer }> {
    const url = this.urlFor(path);
    const init: RequestInit = {
      ...options,
      headers: this.authHeaders(options.headers),
    };

    let response = await fetch(url, init);

    // 429 → back off once and retry. If the caller's signal aborts during
    // the wait (a cancelled MCP call), stop there and send no retry.
    if (response.status === 429) {
      const resetHeader = response.headers.get("ratelimit-reset");
      const waitMs = resetHeader
        ? Math.min(Number(resetHeader) * 1000, 60_000)
        : RATE_LIMIT_BACKOFF_MS;
      await delay(waitMs, undefined, { signal: init.signal ?? undefined });
      response = await fetch(url, init);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const body = bytes.toString("utf8");
    if (!response.ok) {
      throw new KandjiApiError(response.status, path, truncate(body));
    }
    return { contentType: response.headers.get("content-type"), body, bytes };
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const { body } = await this.requestRaw(path, options);
    if (!body) return undefined as unknown as T;
    return JSON.parse(body) as T;
  }

  private withQuery(path: string, params: Record<string, string>): string {
    const entries = Object.entries(params).filter(
      ([, v]) => v !== undefined && v !== "",
    );
    if (entries.length === 0) return path;
    const query = new URLSearchParams(Object.fromEntries(entries)).toString();
    return `${path}?${query}`;
  }

  /**
   * Paginated fetch that handles Kandji's three common list shapes.
   *
   * Termination:
   *  1. maxResults cap reached
   *  2. server returns zero items
   *  3. DRF `next` field is null
   *  4. `total`/`count` is known and we have all of it
   *
   * We deliberately do NOT break on "short page" — the API silently clamps
   * limit on some endpoints (Prism), so a short page is not a reliable EOF.
   *
   * @param envelope  Which response shape to unwrap (bare/`results`/`data`).
   * @param paging    limit/offset (default) or page/size (vuln endpoints).
   * @param startOffset  Initial offset (limit-offset paging only) so callers
   *                     can resume a capped walk instead of re-fetching.
   * @param onMeta    Called once per enveloped page with the server's own
   *                  `total`/`count` and `next` fields, so callers can report
   *                  accurate universe totals / has-more signals instead of
   *                  presenting a capped slice as the whole dataset.
   */
  private async fetchPaginated<T>(
    path: string,
    params: Record<string, string> = {},
    opts: {
      envelope?: Envelope;
      paging?: Paging;
      pageSize?: number;
      maxResults?: number;
      startOffset?: number;
      onMeta?: (meta: { total?: number; next?: unknown }) => void;
    } = {},
  ): Promise<T[]> {
    const envelope = opts.envelope ?? "array";
    const paging = opts.paging ?? "limit-offset";
    const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
    const all: T[] = [];
    let cursor = paging === "page-size" ? 1 : (opts.startOffset ?? 0);
    const MAX_ITERATIONS = 10_000; // belt-and-suspenders against server pagination bugs

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      if (opts.maxResults !== undefined && all.length >= opts.maxResults) break;

      // With limit/offset paging we can shrink the final request to exactly
      // what's left. With page/size paging the `size` param MUST stay
      // constant across hops — pages are server-side buckets of `size`
      // records, so changing size mid-stream re-buckets the whole dataset
      // (records duplicate and drop). Always request full pages and trim
      // the final overshoot client-side after the loop.
      const thisLimit =
        paging === "limit-offset" && opts.maxResults !== undefined
          ? Math.min(pageSize, opts.maxResults - all.length)
          : pageSize;

      const pagingParams: Record<string, string> =
        paging === "limit-offset"
          ? { limit: String(thisLimit), offset: String(cursor) }
          : { size: String(thisLimit), page: String(cursor) };

      const body = await this.request<unknown>(
        this.withQuery(path, { ...params, ...pagingParams }),
      );
      const items = extractItems<T>(body, envelope);

      // Surface envelope metadata (total/next) even for zero-item pages so
      // callers get an accurate has-more/total signal at every stop point.
      if (opts.onMeta && body && typeof body === "object" && !Array.isArray(body)) {
        const obj = body as Record<string, unknown>;
        const metaTotal =
          typeof obj.total === "number"
            ? obj.total
            : typeof obj.count === "number"
              ? obj.count
              : undefined;
        opts.onMeta({
          total: metaTotal,
          next: "next" in obj ? obj.next : undefined,
        });
      }

      if (items.length === 0) break;
      all.push(...items);

      // Explicit end-of-pagination hints from the response envelope.
      if (body && typeof body === "object") {
        const obj = body as Record<string, unknown>;
        if ("next" in obj && obj.next === null) break;
        const total =
          typeof obj.total === "number"
            ? obj.total
            : typeof obj.count === "number"
              ? obj.count
              : undefined;
        if (total !== undefined && all.length >= total) break;
      }

      // Advance the cursor by the number of items we actually received
      // (page-size pagination advances by 1 regardless).
      cursor += paging === "limit-offset" ? items.length : 1;
    }

    // Page-size pagination always requests full pages, so the last page can
    // overshoot maxResults — trim client-side rather than shrinking `size`.
    return opts.maxResults !== undefined && all.length > opts.maxResults
      ? all.slice(0, opts.maxResults)
      : all;
  }

  // ==========================================================================
  // Devices
  // ==========================================================================

  /**
   * /devices returns a bare array, but DRF-wrapped tenants
   * ({count, next, results: [...]}) exist in the wild. extractItems() never
   * throws on a shape mismatch — it returns [] — so a catch-based fallback
   * would be dead code (wrapped tenants would silently get an empty list).
   * Instead, inspect the body shape per page and unwrap whichever form the
   * tenant serves.
   */
  async listDevices(
    params: Record<string, string> = {},
    maxResults?: number,
  ): Promise<unknown[]> {
    return this.fetchPaginated<unknown>("/devices", params, {
      envelope: "array-or-results",
      maxResults,
    });
  }

  async getDevice(deviceId: string): Promise<unknown> {
    return this.request<unknown>(`/devices/${encodeId(deviceId, "device_id")}`);
  }

  async getDeviceDetails(deviceId: string): Promise<unknown> {
    return this.request<unknown>(`/devices/${encodeId(deviceId, "device_id")}/details`);
  }

  async getDeviceApps(deviceId: string): Promise<unknown[]> {
    const body = await this.request<{ apps?: unknown[] } | unknown[]>(
      `/devices/${encodeId(deviceId, "device_id")}/apps`,
    );
    if (Array.isArray(body)) return body;
    return Array.isArray(body?.apps) ? body.apps : [];
  }

  async getDeviceStatus(deviceId: string): Promise<unknown> {
    // Returns {device_id, library_items[], parameters[]} — keep whole object.
    return this.request<unknown>(`/devices/${encodeId(deviceId, "device_id")}/status`);
  }

  /**
   * /devices/:id/activity returns {device_id, activity: {count, next, previous, results[]}}.
   * Pagination via activity.results with limit/offset. Returns the server's
   * own `count` as `total` so callers can report the true universe when a
   * maxResults cap truncates the walk (null when the envelope omits it).
   */
  async getDeviceActivity(
    deviceId: string,
    maxResults?: number,
  ): Promise<{ activity: unknown[]; total: number | null }> {
    const encoded = encodeId(deviceId, "device_id");
    const all: unknown[] = [];
    let offset = 0;
    let total: number | null = null;
    const pageSize = DEFAULT_PAGE_SIZE;
    const MAX_ITERATIONS = 10_000;

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      if (maxResults !== undefined && all.length >= maxResults) break;
      const remaining =
        maxResults !== undefined ? maxResults - all.length : pageSize;
      const thisLimit = Math.min(pageSize, remaining);

      const body = await this.request<{
        activity?: {
          count?: number;
          next?: string | null;
          results?: unknown[];
        };
      }>(
        this.withQuery(`/devices/${encoded}/activity`, {
          limit: String(thisLimit),
          offset: String(offset),
        }),
      );

      const env = body?.activity;
      if (typeof env?.count === "number") total = env.count;
      const results = env?.results;
      if (!Array.isArray(results) || results.length === 0) break;
      all.push(...results);

      if (env?.next === null) break;
      if (typeof env?.count === "number" && all.length >= env.count) break;

      offset += results.length;
    }

    return { activity: all, total };
  }

  async getDeviceLibraryItems(deviceId: string): Promise<unknown[]> {
    const body = await this.request<{ library_items?: unknown[] }>(
      `/devices/${encodeId(deviceId, "device_id")}/library-items`,
    );
    return Array.isArray(body?.library_items) ? body.library_items : [];
  }

  async getDeviceParameters(deviceId: string): Promise<unknown[]> {
    const body = await this.request<{ parameters?: unknown[] }>(
      `/devices/${encodeId(deviceId, "device_id")}/parameters`,
    );
    return Array.isArray(body?.parameters) ? body.parameters : [];
  }

  /**
   * /devices/:id/commands returns {device_id, commands: {results[], ...}}.
   * Unwrap so the tool returns a flat list.
   */
  async getDeviceCommands(deviceId: string): Promise<unknown[]> {
    const body = await this.request<{
      commands?: { results?: unknown[] };
    }>(`/devices/${encodeId(deviceId, "device_id")}/commands`);
    return Array.isArray(body?.commands?.results) ? body.commands.results : [];
  }

  async getDeviceNotes(deviceId: string): Promise<unknown[]> {
    const body = await this.request<unknown>(
      `/devices/${encodeId(deviceId, "device_id")}/notes`,
    );
    return Array.isArray(body) ? body : [];
  }

  async getDeviceNote(deviceId: string, noteId: string): Promise<unknown> {
    return this.request<unknown>(
      `/devices/${encodeId(deviceId, "device_id")}/notes/${encodeId(noteId, "note_id")}`,
    );
  }

  async getDeviceSecret(
    deviceId: string,
    kind: DeviceSecretKind,
  ): Promise<unknown> {
    return this.request<unknown>(
      `/devices/${encodeId(deviceId, "device_id")}/secrets/${encodeId(kind, "kind")}`,
    );
  }

  async updateDevice(
    deviceId: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request<unknown>(`/devices/${encodeId(deviceId, "device_id")}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  // ==========================================================================
  // Prism
  // ==========================================================================

  /**
   * Returns the fetched rows plus the Prism envelope's `total` field.
   * Observed in live testing (2026-07-30): `total` is present but null for
   * every category, so callers must treat null as "unknown" and point at
   * /prism/count for true universe counts.
   */
  async getPrismData(
    category: string,
    params: Record<string, string> = {},
    maxResults?: number,
  ): Promise<{ rows: unknown[]; total: number | null }> {
    let total: number | null = null;
    const rows = await this.fetchPaginated<unknown>(
      `/prism/${encodeId(category, "category")}`,
      params,
      {
        envelope: "data",
        maxResults,
        onMeta: (meta) => {
          if (typeof meta.total === "number") total = meta.total;
        },
      },
    );
    return { rows, total };
  }

  /**
   * /prism/count requires `?category=` — a bare GET 404s. Caller fans out
   * across all known categories.
   */
  async getPrismCount(category: PrismCategory | string): Promise<unknown> {
    return this.request<unknown>(
      this.withQuery("/prism/count", { category }),
    );
  }

  // ==========================================================================
  // Audit Log
  // ==========================================================================

  /**
   * The /audit/events DRF envelope carries `next` (URL or null) but NO
   * `count` (observed live 2026-07-30), so has-more is signalled via the
   * final page's `next`. `startOffset` lets callers resume a capped walk.
   */
  async getAuditEvents(
    params: Record<string, string> = {},
    maxResults?: number,
    startOffset?: number,
  ): Promise<{ events: unknown[]; hasMore: boolean }> {
    let lastNext: unknown = null;
    const events = await this.fetchPaginated<unknown>("/audit/events", params, {
      envelope: "results",
      maxResults,
      startOffset,
      onMeta: (meta) => {
        lastNext = meta.next ?? null;
      },
    });
    return { events, hasMore: lastNext !== null };
  }

  // ==========================================================================
  // Users
  // ==========================================================================

  async listUsers(
    params: Record<string, string> = {},
    maxResults?: number,
  ): Promise<unknown[]> {
    return this.fetchPaginated<unknown>("/users", params, {
      envelope: "results",
      maxResults,
    });
  }

  async getUser(userId: string): Promise<unknown> {
    return this.request<unknown>(`/users/${encodeId(userId, "user_id")}`);
  }

  // ==========================================================================
  // Blueprints
  // ==========================================================================

  async listBlueprints(
    params: Record<string, string> = {},
    maxResults?: number,
  ): Promise<unknown[]> {
    return this.fetchPaginated<unknown>("/blueprints", params, {
      envelope: "results",
      maxResults,
    });
  }

  async getBlueprint(blueprintId: string): Promise<unknown> {
    return this.request<unknown>(`/blueprints/${encodeId(blueprintId, "blueprint_id")}`);
  }

  async getBlueprintLibraryItems(
    blueprintId: string,
    maxResults?: number,
  ): Promise<unknown[]> {
    return this.fetchPaginated<unknown>(
      `/blueprints/${encodeId(blueprintId, "blueprint_id")}/list-library-items`,
      {},
      { envelope: "results", maxResults },
    );
  }

  /**
   * /blueprints/templates/ returns Kandji's curated blueprint catalogue —
   * top-level categories (CIS, Compliance, etc.) each holding their own
   * templates[]. Trailing slash is required by the API; without it the
   * request 404s on tenants we've checked.
   */
  async listBlueprintTemplates(
    maxResults?: number,
  ): Promise<unknown[]> {
    return this.fetchPaginated<unknown>(
      "/blueprints/templates/",
      {},
      { envelope: "results", maxResults },
    );
  }

  /**
   * /blueprints/:id/ota-enrollment-profile returns either a signed
   * .mobileconfig (Content-Type: application/x-apple-aspen-config) or, when
   * `?sso=true` is supplied for an SSO-gated blueprint, a JSON {url, …}
   * pointing at the auth flow.
   *
   * The non-SSO payload is a BINARY CMS/PKCS#7 blob (DER, starts 0x3082 —
   * confirmed live 2026-07-30), not XML: decoding it as text corrupts it
   * irreversibly, so it's returned base64-encoded from the raw bytes. It
   * also embeds the tenant's OTA enrollment Challenge secret.
   */
  async getBlueprintOtaEnrollmentProfile(
    blueprintId: string,
    sso?: boolean,
  ): Promise<unknown> {
    const path = this.withQuery(
      `/blueprints/${encodeId(blueprintId, "blueprint_id")}/ota-enrollment-profile`,
      sso ? { sso: "true" } : {},
    );
    const { contentType, body, bytes } = await this.requestRaw(path);
    const ct = (contentType ?? "").toLowerCase();
    const isJson = ct.includes("application/json");
    if (!isJson) {
      return {
        content_type: contentType ?? "application/x-apple-aspen-config",
        filename: "kandji-enroll.mobileconfig",
        encoding: "base64",
        note: "mobileconfig_base64 is a signed CMS/PKCS#7 BINARY profile, base64-encoded. Base64-decode it to raw bytes and save as the .mobileconfig file; do not treat it as XML text. It embeds the tenant's OTA enrollment challenge — handle as a secret.",
        mobileconfig_base64: bytes.toString("base64"),
      };
    }
    return body ? JSON.parse(body) : {};
  }

  // ==========================================================================
  // Vulnerabilities (page/size pagination)
  // ==========================================================================

  async listVulnerabilities(
    params: Record<string, string> = {},
    maxResults?: number,
  ): Promise<unknown[]> {
    return this.fetchPaginated<unknown>(
      "/vulnerability-management/vulnerabilities",
      params,
      { envelope: "results", paging: "page-size", maxResults },
    );
  }

  async getVulnerability(cveId: string): Promise<unknown> {
    return this.request<unknown>(
      `/vulnerability-management/vulnerabilities/${encodeId(cveId, "cve_id")}`,
    );
  }

  async getVulnerabilityDevices(
    cveId: string,
    params: Record<string, string> = {},
    maxResults?: number,
  ): Promise<unknown[]> {
    return this.fetchPaginated<unknown>(
      `/vulnerability-management/vulnerabilities/${encodeId(cveId, "cve_id")}/devices`,
      params,
      { envelope: "results", paging: "page-size", maxResults },
    );
  }

  async getVulnerabilitySoftware(
    cveId: string,
    params: Record<string, string> = {},
    maxResults?: number,
  ): Promise<unknown[]> {
    return this.fetchPaginated<unknown>(
      `/vulnerability-management/vulnerabilities/${encodeId(cveId, "cve_id")}/software`,
      params,
      { envelope: "results", paging: "page-size", maxResults },
    );
  }

  async listVulnerabilityDetections(
    params: Record<string, string> = {},
    maxResults?: number,
  ): Promise<unknown[]> {
    return this.fetchPaginated<unknown>(
      "/vulnerability-management/detections",
      params,
      { envelope: "results", paging: "page-size", maxResults },
    );
  }

  // ==========================================================================
  // Library Items
  // ==========================================================================

  async listCustomApps(
    params: Record<string, string> = {},
    maxResults?: number,
  ): Promise<unknown[]> {
    return this.fetchPaginated<unknown>("/library/custom-apps", params, {
      envelope: "results",
      maxResults,
    });
  }

  async getCustomApp(libraryItemId: string): Promise<unknown> {
    return this.request<unknown>(
      `/library/custom-apps/${encodeId(libraryItemId, "library_item_id")}`,
    );
  }

  async listInHouseApps(
    params: Record<string, string> = {},
    maxResults?: number,
  ): Promise<unknown[]> {
    return this.fetchPaginated<unknown>("/library/ipa-apps", params, {
      envelope: "results",
      maxResults,
    });
  }

  async getInHouseApp(libraryItemId: string): Promise<unknown> {
    return this.request<unknown>(
      `/library/ipa-apps/${encodeId(libraryItemId, "library_item_id")}`,
    );
  }

  async listCustomProfiles(
    params: Record<string, string> = {},
    maxResults?: number,
  ): Promise<unknown[]> {
    return this.fetchPaginated<unknown>("/library/custom-profiles", params, {
      envelope: "results",
      maxResults,
    });
  }

  async getCustomProfile(libraryItemId: string): Promise<unknown> {
    return this.request<unknown>(
      `/library/custom-profiles/${encodeId(libraryItemId, "library_item_id")}`,
    );
  }

  async listCustomScripts(
    params: Record<string, string> = {},
    maxResults?: number,
  ): Promise<unknown[]> {
    return this.fetchPaginated<unknown>("/library/custom-scripts", params, {
      envelope: "results",
      maxResults,
    });
  }

  async getCustomScript(libraryItemId: string): Promise<unknown> {
    return this.request<unknown>(
      `/library/custom-scripts/${encodeId(libraryItemId, "library_item_id")}`,
    );
  }

  async getLibraryItemStatus(
    libraryItemId: string,
    maxResults?: number,
  ): Promise<unknown[]> {
    return this.fetchPaginated<unknown>(
      `/library/library-items/${encodeId(libraryItemId, "library_item_id")}/status`,
      {},
      { envelope: "results", maxResults },
    );
  }

  async getLibraryItemActivity(
    libraryItemId: string,
    maxResults?: number,
  ): Promise<unknown[]> {
    return this.fetchPaginated<unknown>(
      `/library/library-items/${encodeId(libraryItemId, "library_item_id")}/activity`,
      {},
      { envelope: "results", maxResults },
    );
  }

  async listSelfServiceCategories(): Promise<unknown[]> {
    const body = await this.request<unknown>("/self-service/categories");
    return Array.isArray(body) ? body : [];
  }

  // ==========================================================================
  // Threats / EDR (license-gated)
  //
  // Both endpoints exist at v1 AND v2, but tenants vary on which is enabled
  // (older tenants 404 on v2; some scopes only expose v1). Try v1 first; on
  // 404 fall back to v2 and remember the working path for the rest of the
  // process so we don't pay the round-trip per call. The v2 paths carry their
  // own version segment, so `urlFor` resolves them against the API root
  // (`/api/v2/threat/...`), not the v1 base URL.
  // ==========================================================================

  private threatsPath: "v1" | "v2" | null = null;
  private behavioralPath: "v1" | "v2" | null = null;

  async getThreats(
    params: Record<string, string> = {},
    maxResults?: number,
  ): Promise<unknown[]> {
    return this.fetchWithVersionFallback(
      () => this.threatsPath,
      (v) => (this.threatsPath = v),
      "/threat-details",
      "/v2/threat/threat-details",
      "EDR threats",
      params,
      maxResults,
    );
  }

  async getBehavioralDetections(
    params: Record<string, string> = {},
    maxResults?: number,
  ): Promise<unknown[]> {
    return this.fetchWithVersionFallback(
      () => this.behavioralPath,
      (v) => (this.behavioralPath = v),
      "/behavioral-detections",
      "/v2/threat/behavioral-detections/events",
      "EDR behavioral detections",
      params,
      maxResults,
    );
  }

  /** Cached path getters — exposed for tests/diagnostics. */
  getResolvedThreatsPath(): "v1" | "v2" | null {
    return this.threatsPath;
  }
  getResolvedBehavioralPath(): "v1" | "v2" | null {
    return this.behavioralPath;
  }

  /**
   * Try the cached path first (or v1 by default), fall through to the other
   * version on 404, and surface a `KandjiLicenseGatedError` when both 404 —
   * the canonical signal that the EDR licence isn't enabled on the tenant.
   * Logs to stderr on cache change so operators can see which path resolved.
   */
  private async fetchWithVersionFallback(
    getCached: () => "v1" | "v2" | null,
    setCached: (v: "v1" | "v2") => void,
    v1Path: string,
    v2Path: string,
    feature: string,
    params: Record<string, string>,
    maxResults?: number,
  ): Promise<unknown[]> {
    const cached = getCached();
    const tryOrder: Array<{ version: "v1" | "v2"; path: string }> =
      cached === "v2"
        ? [
            { version: "v2", path: v2Path },
            { version: "v1", path: v1Path },
          ]
        : [
            { version: "v1", path: v1Path },
            { version: "v2", path: v2Path },
          ];

    const tried: string[] = [];
    for (const { version, path } of tryOrder) {
      tried.push(path);
      try {
        const result = await this.fetchPaginated<unknown>(path, params, {
          envelope: "results",
          maxResults,
        });
        if (cached !== version) {
          setCached(version);
          // Single-line stderr ping so operators can confirm fallback worked.
          console.error(`[kandji-mcp] ${feature} resolved to ${version} (${path})`);
        }
        return result;
      } catch (err) {
        if (err instanceof KandjiApiError && err.status === 404) {
          continue;
        }
        throw err;
      }
    }

    // Both paths 404'd — fold into a structured licence-gated signal so the
    // handler can return the documented graceful-degradation shape. Log the
    // attempt so operators can see the fallback ran.
    console.error(
      `[kandji-mcp] ${feature} appears licence-gated — tried ${tried.join(", ")} (both 404)`,
    );
    throw new KandjiLicenseGatedError(tried, feature);
  }

  // ==========================================================================
  // Tags
  // ==========================================================================

  async listTags(maxResults?: number): Promise<unknown[]> {
    return this.fetchPaginated<unknown>(
      "/tags",
      {},
      { envelope: "results", maxResults },
    );
  }

  async createTag(name: string): Promise<unknown> {
    return this.request<unknown>("/tags", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }

  async updateTag(tagId: string, name: string): Promise<unknown> {
    return this.request<unknown>(`/tags/${encodeId(tagId, "tag_id")}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
  }

  async deleteTag(tagId: string): Promise<unknown> {
    return this.request<unknown>(`/tags/${encodeId(tagId, "tag_id")}`, {
      method: "DELETE",
    });
  }

  // ==========================================================================
  // Settings
  // ==========================================================================

  async getLicensing(): Promise<unknown> {
    return this.request<unknown>("/settings/licensing");
  }

  // ==========================================================================
  // ADE (Automated Device Enrollment) — reads only
  // ==========================================================================

  async listAdeIntegrations(
    maxResults?: number,
  ): Promise<unknown[]> {
    return this.fetchPaginated<unknown>(
      "/integrations/apple/ade",
      {},
      { envelope: "results", maxResults },
    );
  }

  async getAdeIntegration(tokenId: string): Promise<unknown> {
    return this.request<unknown>(
      `/integrations/apple/ade/${encodeId(tokenId, "ade_token_id")}`,
    );
  }

  async listAdeDevicesForToken(
    tokenId: string,
    params: Record<string, string> = {},
    maxResults?: number,
  ): Promise<unknown[]> {
    return this.fetchPaginated<unknown>(
      `/integrations/apple/ade/${encodeId(tokenId, "ade_token_id")}/devices`,
      params,
      { envelope: "results", maxResults },
    );
  }

  async listAdeDevices(
    params: Record<string, string> = {},
    maxResults?: number,
  ): Promise<unknown[]> {
    return this.fetchPaginated<unknown>(
      "/integrations/apple/ade/devices",
      params,
      { envelope: "results", maxResults },
    );
  }

  async getAdeDevice(adeDeviceId: string): Promise<unknown> {
    return this.request<unknown>(
      `/integrations/apple/ade/devices/${encodeId(adeDeviceId, "ade_device_id")}`,
    );
  }

  /**
   * The ADE public-key endpoint returns a raw PEM (Content-Type:
   * application/x-pem-file or text/plain), not JSON. Detect that via headers
   * and a "-----BEGIN" body sniff and wrap the PEM rather than JSON.parse'ing
   * it (which fails with "No number after minus sign in JSON at position 1").
   */
  async getAdePublicKey(): Promise<{ public_key: string } | unknown> {
    const { contentType, body } = await this.requestRaw(
      "/integrations/apple/ade/public_key/",
    );
    const isPem =
      (contentType !== null && !contentType.includes("application/json")) ||
      body.trimStart().startsWith("-----BEGIN");
    if (isPem) return { public_key: body };
    return body ? JSON.parse(body) : { public_key: "" };
  }

  // ==========================================================================
  // Blueprint Routing — reads only
  // ==========================================================================

  async getBlueprintRouting(): Promise<unknown> {
    return this.request<unknown>("/blueprint-routing/");
  }

  async getBlueprintRoutingActivity(
    maxResults?: number,
  ): Promise<unknown[]> {
    return this.fetchPaginated<unknown>(
      "/blueprint-routing/activity",
      {},
      { envelope: "results", maxResults },
    );
  }

  // ==========================================================================
  // Device Lost-Mode state (read)
  // ==========================================================================

  async getDeviceLostMode(deviceId: string): Promise<unknown> {
    return this.request<unknown>(
      `/devices/${encodeId(deviceId, "device_id")}/details/lostmode`,
    );
  }

  // ==========================================================================
  // Prism async export (request + poll)
  // ==========================================================================

  async requestPrismExport(
    category: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> {
    // category is the validated positional parameter — spread args first so
    // a stray `category` key inside args can never override it.
    return this.request<unknown>("/prism/export", {
      method: "POST",
      body: JSON.stringify({ ...args, category }),
    });
  }

  async getPrismExport(exportId: string): Promise<unknown> {
    return this.request<unknown>(
      `/prism/export/${encodeId(exportId, "export_id")}`,
    );
  }

  // ==========================================================================
  // Device Notes (write) — low risk, fully reversible
  // ==========================================================================

  async createDeviceNote(
    deviceId: string,
    content: string,
  ): Promise<unknown> {
    return this.request<unknown>(
      `/devices/${encodeId(deviceId, "device_id")}/notes`,
      {
        method: "POST",
        body: JSON.stringify({ content }),
      },
    );
  }

  async updateDeviceNote(
    deviceId: string,
    noteId: string,
    content: string,
  ): Promise<unknown> {
    return this.request<unknown>(
      `/devices/${encodeId(deviceId, "device_id")}/notes/${encodeId(noteId, "note_id")}`,
      {
        method: "PATCH",
        body: JSON.stringify({ content }),
      },
    );
  }

  async deleteDeviceNote(
    deviceId: string,
    noteId: string,
  ): Promise<unknown> {
    return this.request<unknown>(
      `/devices/${encodeId(deviceId, "device_id")}/notes/${encodeId(noteId, "note_id")}`,
      { method: "DELETE" },
    );
  }

  // ==========================================================================
  // Benign device actions (refresh-only, non-destructive)
  // ==========================================================================

  async triggerUpdateInventory(deviceId: string): Promise<unknown> {
    return this.request<unknown>(
      `/devices/${encodeId(deviceId, "device_id")}/action/updateinventory`,
      { method: "POST", body: "" },
    );
  }

  async triggerDailyCheckin(deviceId: string): Promise<unknown> {
    return this.request<unknown>(
      `/devices/${encodeId(deviceId, "device_id")}/action/dailycheckin`,
      { method: "POST", body: "" },
    );
  }

  // ==========================================================================
  // Generic device action — POST /devices/{id}/action/<action>
  //
  // Used for the destructive/disruptive actions (lock, erase, restart, etc.)
  // and the lost-mode workflow. Action verb is the URL segment Kandji's API
  // expects (lock, erase, clearpasscode, …) — caller composes the verb so
  // we don't have to maintain a hand-rolled enum that drifts from the API.
  // ==========================================================================

  async triggerDeviceAction(
    deviceId: string,
    action: string,
    payload?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const init: RequestInit = { method: "POST" };
    init.body = payload && Object.keys(payload).length > 0
      ? JSON.stringify(payload)
      : "";
    // Once `signal` aborts, fetch sends nothing new and the 429 backoff
    // sends no retry.
    if (signal) init.signal = signal;
    return this.request<unknown>(
      `/devices/${encodeId(deviceId, "device_id")}/action/${encodeId(action, "action")}`,
      init,
    );
  }

  // ==========================================================================
  // Blueprints (write)
  // ==========================================================================

  /**
   * POST /blueprints — Kandji's Django serializer for this endpoint expects
   * form-encoded data with dotted-key nesting (e.g. `enrollment_code.is_active=true`),
   * NOT JSON. Sending JSON returns 400 ("enrollment_code: This field is required.")
   * even if you nest it correctly, or 500 from a downstream crash. Confirmed
   * against a live tenant and the upstream API docs (api-docs.iru.com).
   *
   * We always inject `enrollment_code.is_active=true` if the caller didn't
   * supply it — the upstream API rejects requests without it despite the
   * field being conceptually optional. The full enrollment_code object
   * (with the server-generated 6-digit code) is returned in the response.
   */
  async createBlueprint(payload: Record<string, unknown>): Promise<unknown> {
    const ec = (payload.enrollment_code as Record<string, unknown>) ?? {};
    const merged: Record<string, unknown> = {
      ...payload,
      enrollment_code: { is_active: true, ...ec },
    };
    const body = toFormBody(merged).toString();
    if (process.env.KANDJI_DEBUG === "1") {
      process.stderr.write(
        `[kandji-mcp] POST /blueprints body=${body}\n`,
      );
    }
    return this.request<unknown>("/blueprints", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  }

  async updateBlueprint(
    blueprintId: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request<unknown>(`/blueprints/${encodeId(blueprintId, "blueprint_id")}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async deleteBlueprint(blueprintId: string): Promise<unknown> {
    return this.request<unknown>(`/blueprints/${encodeId(blueprintId, "blueprint_id")}`, {
      method: "DELETE",
    });
  }

  async assignLibraryItemToBlueprint(
    blueprintId: string,
    libraryItemId: string,
  ): Promise<unknown> {
    return this.request<unknown>(
      `/blueprints/${encodeId(blueprintId, "blueprint_id")}/assign_library_item`,
      {
        method: "POST",
        body: JSON.stringify({ library_item_id: libraryItemId }),
      },
    );
  }

  async removeLibraryItemFromBlueprint(
    blueprintId: string,
    libraryItemId: string,
  ): Promise<unknown> {
    return this.request<unknown>(
      `/blueprints/${encodeId(blueprintId, "blueprint_id")}/remove_library_item`,
      {
        method: "POST",
        body: JSON.stringify({ library_item_id: libraryItemId }),
      },
    );
  }

  // ==========================================================================
  // Library Items (write)
  //
  // Custom apps and IPA apps additionally support a presigned-S3 binary
  // upload via POST /library/{type}/upload — that returns a signed URL
  // and file_key the caller then uses to POST the binary directly to S3
  // and reference in a subsequent create. We only wrap step 1 (the
  // presigned URL request); the S3 upload itself is out of scope for a
  // thin MCP wrapper because it expects multipart binary, not JSON.
  // ==========================================================================

  async createCustomApp(payload: Record<string, unknown>): Promise<unknown> {
    return this.request<unknown>("/library/custom-apps", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updateCustomApp(
    libraryItemId: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request<unknown>(
      `/library/custom-apps/${encodeId(libraryItemId, "library_item_id")}`,
      { method: "PATCH", body: JSON.stringify(payload) },
    );
  }

  async deleteCustomApp(libraryItemId: string): Promise<unknown> {
    return this.request<unknown>(
      `/library/custom-apps/${encodeId(libraryItemId, "library_item_id")}`,
      { method: "DELETE" },
    );
  }

  async requestCustomAppUpload(name: string): Promise<unknown> {
    return this.request<unknown>("/library/custom-apps/upload", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }

  /**
   * POST /library/custom-profiles is multipart/form-data:
   *   - `file`: the .mobileconfig XML uploaded as a file part
   *   - at least one of `runs_on_mac/iphone/ipad/tv/vision`/`runs_on_windows`
   *     must be `true` — the API rejects with "At least one valid device
   *     family must be specified" otherwise. Confirmed live 2026-05-07.
   *
   * `payload.mobileconfig` is the XML string; we wrap it as a file part with
   * a deterministic filename. All other keys flow through as form fields.
   */
  async createCustomProfile(payload: {
    name: string;
    mobileconfig: string;
    runs_on_mac?: boolean;
    runs_on_iphone?: boolean;
    runs_on_ipad?: boolean;
    runs_on_tv?: boolean;
    runs_on_vision?: boolean;
    [key: string]: unknown;
  }): Promise<unknown> {
    const { mobileconfig, ...rest } = payload;
    const { body, contentType } = toMultipartBody(rest, {
      file: {
        filename: `${(rest.name as string) || "profile"}.mobileconfig`,
        content: mobileconfig,
        contentType: "application/x-apple-aspen-config",
      },
    });
    return this.request<unknown>("/library/custom-profiles", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: new Uint8Array(body),
    });
  }

  /**
   * PATCH /library/custom-profiles/:id supports both JSON (for metadata-only
   * changes like rename) AND multipart (when replacing the .mobileconfig).
   * If `mobileconfig` is supplied we send multipart with a `file` part;
   * otherwise we PATCH JSON. Confirmed live 2026-05-07: both work, picking
   * multipart only when needed avoids unnecessary file rewrites server-side.
   */
  async updateCustomProfile(
    libraryItemId: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    const path = `/library/custom-profiles/${encodeId(libraryItemId, "library_item_id")}`;
    if (typeof payload.mobileconfig === "string") {
      const { mobileconfig, ...rest } = payload as {
        mobileconfig: string;
        [k: string]: unknown;
      };
      const { body, contentType } = toMultipartBody(rest, {
        file: {
          filename: `${(rest.name as string) || "profile"}.mobileconfig`,
          content: mobileconfig,
          contentType: "application/x-apple-aspen-config",
        },
      });
      return this.request<unknown>(path, {
        method: "PATCH",
        headers: { "Content-Type": contentType },
        body: new Uint8Array(body),
      });
    }
    return this.request<unknown>(path, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async deleteCustomProfile(libraryItemId: string): Promise<unknown> {
    return this.request<unknown>(
      `/library/custom-profiles/${encodeId(libraryItemId, "library_item_id")}`,
      { method: "DELETE" },
    );
  }

  async createCustomScript(payload: Record<string, unknown>): Promise<unknown> {
    return this.request<unknown>("/library/custom-scripts", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updateCustomScript(
    libraryItemId: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request<unknown>(
      `/library/custom-scripts/${encodeId(libraryItemId, "library_item_id")}`,
      { method: "PATCH", body: JSON.stringify(payload) },
    );
  }

  async deleteCustomScript(libraryItemId: string): Promise<unknown> {
    return this.request<unknown>(
      `/library/custom-scripts/${encodeId(libraryItemId, "library_item_id")}`,
      { method: "DELETE" },
    );
  }

  async createInHouseApp(payload: Record<string, unknown>): Promise<unknown> {
    return this.request<unknown>("/library/ipa-apps", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updateInHouseApp(
    libraryItemId: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request<unknown>(
      `/library/ipa-apps/${encodeId(libraryItemId, "library_item_id")}`,
      { method: "PATCH", body: JSON.stringify(payload) },
    );
  }

  async deleteInHouseApp(libraryItemId: string): Promise<unknown> {
    return this.request<unknown>(
      `/library/ipa-apps/${encodeId(libraryItemId, "library_item_id")}`,
      { method: "DELETE" },
    );
  }

  /**
   * POST /library/ipa-apps/upload — note the asymmetry with the custom-app
   * sibling: this endpoint requires `filename`, while custom-apps/upload
   * takes `name`. Confirmed live 2026-05-07. Caller passes the .ipa filename
   * (e.g. "InternalApp.ipa") and we forward it under the right key.
   */
  async requestInHouseAppUpload(filename: string): Promise<unknown> {
    return this.request<unknown>("/library/ipa-apps/upload", {
      method: "POST",
      body: JSON.stringify({ filename }),
    });
  }

  // ==========================================================================
  // Health Check
  // ==========================================================================

  async testConnection(): Promise<{ ok: boolean; deviceCount: number }> {
    const result = await this.request<unknown>("/devices?limit=1&offset=0");
    if (Array.isArray(result)) {
      return { ok: true, deviceCount: result.length };
    }
    if (result && typeof result === "object") {
      const wrapped = (result as { results?: unknown[] }).results;
      if (Array.isArray(wrapped)) {
        return { ok: true, deviceCount: wrapped.length };
      }
    }
    return { ok: true, deviceCount: 0 };
  }
}

let instance: KandjiClientInstance | null = null;

export function getKandjiClient(): KandjiClientInstance {
  if (!instance) {
    instance = new KandjiClientInstance();
  }
  return instance;
}
