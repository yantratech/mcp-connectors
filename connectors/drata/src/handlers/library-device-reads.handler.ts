import { getDrataClient } from "../clients/drata-client.js";
import {
  type V2ListEnvelope,
  wrapV2List,
  wrapV2Merged,
} from "./v2-write.handler.js";
import { mapDrataError } from "../helpers/error-mapping.js";

const catchError = mapDrataError;
import { projectFields } from "../helpers/field-selection.js";
import { resolvePersonnelIdByEmail } from "./v2-write.handler.js";
import type { DrataClientResponse } from "../types/drata-client-response.js";
import type { DrataQueryParams } from "../clients/drata-client.js";

// ── Helpers ─────────────────────────────────────────────────────
/** True when the caller asked for an explicit page rather than a full walk. */
function wantsExplicitPage(params?: DrataQueryParams): boolean {
  return Boolean(params?.cursor || params?.size || params?.includeTotalCount);
}

/**
 * Shared dual-mode list: explicit page (cursor/size/includeTotalCount given)
 * via getV2 + wrapV2List, otherwise fetchAllV2 + wrapV2Merged. Optional
 * `fields` projection applies in both modes.
 */
async function listV2DualMode(
  key: string,
  path: string,
  params?: DrataQueryParams,
  options?: { fields?: string[] },
): Promise<Record<string, unknown>> {
  const client = getDrataClient();
  if (wantsExplicitPage(params)) {
    const result = await client.getV2<V2ListEnvelope<unknown>>(path, params);
    if (options?.fields && Array.isArray(result.data)) {
      result.data = projectFields(
        result.data as Record<string, unknown>[],
        options.fields,
      );
    }
    return wrapV2List(key, result, params?.cursor);
  }
  const items = await client.fetchAllV2(path, params);
  const projected = options?.fields
    ? projectFields(items as Record<string, unknown>[], options.fields)
    : items;
  return wrapV2Merged(key, projected);
}

// ── Controls (V2 single + requirement comparison) ───────────────

export async function getControl(
  workspaceId: number | undefined,
  controlId: number,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    const result = await client.getV2(
      `/public/v2/workspaces/${wId}/controls/${controlId}`,
      params,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function getControlRequirementComparison(
  workspaceId: number | undefined,
  controlIds: number[],
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    const result = await client.getV2(
      `/public/v2/workspaces/${wId}/controls-requirement-comparison`,
      { ...params, "controlIds[]": controlIds.map(String) },
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

// ── Control library (templates; not workspace-scoped) ───────────

export async function listControlLibrary(
  params?: DrataQueryParams,
  options?: { fields?: string[] },
): Promise<DrataClientResponse<unknown>> {
  try {
    const result = await listV2DualMode(
      "templates",
      "/public/v2/control-library",
      params,
      options,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function getControlLibraryItem(
  templateId: number,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.getV2(
      `/public/v2/control-library/${templateId}`,
      params,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

// ── Risk library (register-scoped; IDs are strings) ─────────────

export async function listRiskLibrary(
  riskRegisterId: number | undefined,
  params?: DrataQueryParams,
  options?: { fields?: string[] },
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const rId = client.resolveRiskRegisterId(riskRegisterId);
    const result = await listV2DualMode(
      "libraryRisks",
      `/public/v2/risk-registers/${rId}/risk-library`,
      params,
      options,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function getRiskLibraryItem(
  riskRegisterId: number | undefined,
  riskLibraryId: string,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const rId = client.resolveRiskRegisterId(riskRegisterId);
    const result = await client.getV2(
      `/public/v2/risk-registers/${rId}/risk-library/${encodeURIComponent(riskLibraryId)}`,
      params,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

// ── Device drill-down reads ─────────────────────────────────────

export async function getDevice(
  deviceId: number,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.getV2(
      `/public/v2/devices/${deviceId}`,
      params,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function listDeviceApps(
  deviceId: number,
  params?: DrataQueryParams,
  options?: { fields?: string[] },
): Promise<DrataClientResponse<unknown>> {
  try {
    const result = await listV2DualMode(
      "apps",
      `/public/v2/devices/${deviceId}/apps`,
      params,
      options,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function listPersonnelDevices(
  target: { personnelId?: number; lookupEmail?: string },
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const provided = [target.personnelId, target.lookupEmail].filter(
      (v) => v !== undefined,
    );
    if (provided.length !== 1) {
      throw new Error("Provide exactly one of: personnelId, lookupEmail");
    }
    const pId =
      target.personnelId ??
      (await resolvePersonnelIdByEmail(target.lookupEmail as string));
    const result = await listV2DualMode(
      "devices",
      `/public/v2/personnel/${pId}/devices`,
      params,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function listConnectionDevices(
  connectionId: number,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const result = await listV2DualMode(
      "devices",
      `/public/v2/connections/${connectionId}/devices`,
      params,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}
