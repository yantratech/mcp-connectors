import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

/**
 * Allowlist of denormalised device columns Kandji adds to every Prism row.
 * Kept generous on purpose — any field that's plausibly device-level lands
 * here so it gets hoisted into the `devices` map. The tail end of this list
 * (model_name, mdm_enabled, supplementary_*, agent_installed_at, ...) covers
 * device columns that real tenants return on every row.
 *
 * Anything NOT in this allowlist is double-checked by a heuristic in
 * `compactRows`: if a field's value is identical for every row of a given
 * device, it's almost certainly device-level too and gets hoisted.
 */
const DEVICE_FIELDS = [
  "device_id",
  "device_name",
  "name",
  "model",
  "model_id",
  "model_name",
  "platform",
  "serial_number",
  "udid",
  "os_version",
  "supplementary_os_version_extra",
  "supplementary_build_version",
  "last_check_in",
  "first_enrollment",
  "agent_installed_at",
  "mdm_enabled",
  "ade_eligibility",
  "ade_enrolled",
  "enrollment_type",
  "user_id",
  "user_email",
  "user_name",
  "user",
  "blueprint_id",
  "blueprint_name",
  "asset_tag",
  "tags",
] as const;

/**
 * Categories that fan out per-row (one row per app/user/agent/permission per
 * device). Even after device hoisting these dwarf the token budget on a
 * non-trivial fleet, so the default cap is tighter. Other categories
 * (filevault, activation_lock, ...) are 1 row/device — 50 is plenty.
 */
const FAN_OUT_CATEGORIES = new Set<string>([
  "apps",
  "local_users",
  "transparency_database",
  "launch_agents_and_daemons",
]);

const DEFAULT_MAX_RESULTS = 50;
const FAN_OUT_DEFAULT_MAX_RESULTS = 20;
const SUMMARY_SAMPLE_SIZE = 3;
const HEURISTIC_MIN_ROWS = 3;

export interface PrismOptions {
  maxResults?: number;
  fields?: string[];
  summary?: boolean;
}

/**
 * Truncation/universe signals deliberately serialize BEFORE the devices map
 * and rows array so a consumer that skims (or clips) the payload sees them
 * first. `returned` is the row count of THIS response — never presented as
 * the fleet universe; `total_available` is the server-reported total (null
 * when the Prism envelope doesn't provide one, which is the observed live
 * behavior — prism_count is the loud path to true per-category totals).
 */
interface CompactedPayload {
  category: string;
  returned: number;
  total_available: number | null;
  truncated: boolean;
  default_cap_applied?: number;
  note?: string;
  fields_projected?: string[];
  fields_unknown?: string[];
  devices_in_slice: number;
  devices: Record<string, Record<string, unknown>>;
  rows: Array<Record<string, unknown>>;
}

interface SummaryPayload {
  category: string;
  returned: number;
  total_available: number | null;
  truncated: boolean;
  default_cap_applied?: number;
  note?: string;
  devices_in_slice: number;
  by_device: Record<string, number>;
  devices: Record<string, Record<string, unknown>>;
  sample: Array<Record<string, unknown>>;
}

function defaultCapFor(category: string): number {
  return FAN_OUT_CATEGORIES.has(category)
    ? FAN_OUT_DEFAULT_MAX_RESULTS
    : DEFAULT_MAX_RESULTS;
}

/**
 * Fetch a Prism category and shape it for token-efficient delivery.
 *
 * Default response:
 *   { category, returned, total_available, truncated, default_cap_applied?,
 *     note?, devices_in_slice, devices: { <id>: { ...device-level cols } },
 *     rows: [{ device_id, ...category-specific cols only }] }
 *
 * `summary: true` collapses rows to per-device counts + a 3-row sample but
 * carries the SAME truncation signals — its counts reflect only the fetched
 * (capped) slice, never a silently-truncated "universe".
 *
 * Truncation is detected by requesting cap+1 rows and trimming: the Prism
 * envelope's `total` is null on live tenants, so an extra row is the only
 * reliable more-exists probe.
 *
 * `fields: [...]` projects rows down (device_id always retained). Fields
 * the caller asks for that don't appear in any returned row come back in
 * `fields_unknown` so typos like "app_name" (vs the real "bundle_name")
 * stop silently disappearing.
 */
export async function getPrismData(
  category: string,
  options: PrismOptions = {},
): Promise<KandjiClientResponse<CompactedPayload | SummaryPayload>> {
  try {
    const client = getKandjiClient();
    const cap = options.maxResults ?? defaultCapFor(category);
    const fetched = await client.getPrismData(category, {}, cap + 1);
    const truncated =
      fetched.rows.length > cap ||
      (fetched.total !== null && fetched.rows.length < fetched.total);
    const rawRows =
      fetched.rows.length > cap ? fetched.rows.slice(0, cap) : fetched.rows;
    const totalAvailable = fetched.total;
    const { devices, rows } = compactRows(rawRows);
    const truncationNote = `Showing first ${rows.length} of ${
      totalAvailable ?? "an unknown total of"
    } rows — rows fill device-by-device, so the devices map may cover only part of the fleet. Raise max_results to fetch more; use prism_count for exact per-category universe counts.`;

    if (options.summary) {
      const byDevice: Record<string, number> = {};
      for (const row of rows) {
        const id = (row.device_id as string | undefined) ?? "_unknown";
        byDevice[id] = (byDevice[id] ?? 0) + 1;
      }
      // Sample rows go through the same compaction (already done) so the
      // shape matches `rows` in the default mode.
      return {
        isError: false,
        result: {
          category,
          returned: rows.length,
          total_available: totalAvailable,
          truncated,
          ...(options.maxResults === undefined
            ? { default_cap_applied: cap }
            : {}),
          ...(truncated
            ? {
                note: `by_device counts reflect ONLY the ${rows.length} fetched rows, not the tenant universe. ${truncationNote}`,
              }
            : {}),
          devices_in_slice: Object.keys(devices).length,
          by_device: byDevice,
          devices,
          sample: rows.slice(0, SUMMARY_SAMPLE_SIZE),
        },
      };
    }

    let projectedRows = rows;
    let projection: string[] | undefined;
    let fieldsUnknown: string[] | undefined;
    if (options.fields && options.fields.length > 0) {
      // Detect typos: any user-supplied field that didn't appear in any row
      // (after device hoisting) is reported back so the caller can correct.
      const observedRowKeys = new Set<string>();
      for (const row of rows) {
        for (const k of Object.keys(row)) observedRowKeys.add(k);
      }
      if (observedRowKeys.size > 0) {
        const unknown = options.fields.filter(
          (f) => f !== "device_id" && !observedRowKeys.has(f),
        );
        if (unknown.length > 0) fieldsUnknown = unknown;
      }

      projection = [
        "device_id",
        ...options.fields.filter((f) => f !== "device_id"),
      ];
      projectedRows = rows.map((row) => projectFields(row, projection!));
    }

    const payload: CompactedPayload = {
      category,
      returned: projectedRows.length,
      total_available: totalAvailable,
      truncated,
      ...(options.maxResults === undefined ? { default_cap_applied: cap } : {}),
      ...(truncated ? { note: truncationNote } : {}),
      ...(projection ? { fields_projected: projection } : {}),
      ...(fieldsUnknown ? { fields_unknown: fieldsUnknown } : {}),
      devices_in_slice: Object.keys(devices).length,
      devices,
      rows: projectedRows,
    };
    return { isError: false, result: payload };
  } catch (err) {
    return formatKandjiError(err);
  }
}

/**
 * Two-pass row compaction:
 *   Pass 1: bucket rows by device_id.
 *   Pass 2: per device, decide which keys are device-level. A key qualifies if:
 *     (a) it appears in DEVICE_FIELDS (allowlist, single-row devices), OR
 *     (b) the device has ≥3 rows AND the value is identical across all of
 *         them (heuristic — catches per-tenant device columns we didn't
 *         enumerate, like custom fleet attributes).
 *   Output: each device record gets all its hoisted fields once; rows carry
 *   only `device_id` plus category-specific columns.
 */
function compactRows(rawRows: unknown[]): {
  devices: Record<string, Record<string, unknown>>;
  rows: Array<Record<string, unknown>>;
} {
  const deviceRowMap = new Map<string, Array<Record<string, unknown>>>();
  const looseRows: Array<Record<string, unknown>> = [];

  for (const raw of rawRows) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      looseRows.push({ value: raw });
      continue;
    }
    const row = raw as Record<string, unknown>;
    const deviceId = typeof row.device_id === "string" ? row.device_id : null;
    if (deviceId) {
      const arr = deviceRowMap.get(deviceId) ?? [];
      arr.push(row);
      deviceRowMap.set(deviceId, arr);
    } else {
      looseRows.push(row);
    }
  }

  const devices: Record<string, Record<string, unknown>> = {};
  const allRows: Array<Record<string, unknown>> = [];

  for (const [deviceId, deviceRows] of deviceRowMap) {
    const allKeys = new Set<string>();
    for (const r of deviceRows) {
      for (const k of Object.keys(r)) allKeys.add(k);
    }

    const deviceLevelKeys = new Set<string>();
    for (const key of allKeys) {
      if (key === "device_id") continue;
      if ((DEVICE_FIELDS as readonly string[]).includes(key)) {
        deviceLevelKeys.add(key);
        continue;
      }
      // Heuristic only kicks in with enough rows to be confident.
      if (deviceRows.length < HEURISTIC_MIN_ROWS) continue;
      if (isConstantAcrossRows(deviceRows, key)) {
        deviceLevelKeys.add(key);
      }
    }

    const deviceRecord: Record<string, unknown> = { device_id: deviceId };
    for (const key of deviceLevelKeys) {
      const val = deviceRows[0]?.[key];
      if (val !== undefined && val !== null) deviceRecord[key] = val;
    }
    devices[deviceId] = deviceRecord;

    for (const r of deviceRows) {
      const rowFields: Record<string, unknown> = { device_id: deviceId };
      for (const [k, v] of Object.entries(r)) {
        if (k === "device_id" || deviceLevelKeys.has(k)) continue;
        rowFields[k] = v;
      }
      allRows.push(rowFields);
    }
  }

  allRows.push(...looseRows);
  return { devices, rows: allRows };
}

function isConstantAcrossRows(
  rows: Array<Record<string, unknown>>,
  key: string,
): boolean {
  if (rows.length === 0) return false;
  const first = rows[0]?.[key];
  if (first === undefined || first === null) return false;
  // Deep-equal on objects/arrays is more cost than the 1.5KB savings is
  // worth — limit to scalars where strict-equal is meaningful.
  if (typeof first === "object") return false;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]?.[key] !== first) return false;
  }
  return true;
}

function projectFields(
  row: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f in row) out[f] = row[f];
  }
  return out;
}
