import {
  getDrataClient,
  flattenPersonnel,
  compactPersonnel,
  DrataApiError,
} from "../clients/drata-client.js";
import { mapDrataError } from "../helpers/error-mapping.js";
import { projectFields } from "../helpers/field-selection.js";
import {
  V2_CONTROL_EXPANDS,
  enrichV2Control,
  normalizeTag,
  type V2Control,
} from "../helpers/v2-control-evidence.js";
import type { DrataClientResponse } from "../types/drata-client-response.js";
import type { DrataQueryParams } from "../clients/drata-client.js";

// ── Helpers ─────────────────────────────────────────────────────

const catchError = mapDrataError;

export interface V2ListEnvelope<T> {
  data?: T[];
  pagination?: { cursor: string | null; totalCount?: number };
}

/**
 * Standard envelope for single-page V2 list responses. Four guarantees:
 *   • A typed key (e.g. `controlOwners`) replaces the raw `data`.
 *   • `returned` is always the count in this page.
 *   • `total` means "items in the workspace/query": Drata's
 *     pagination.totalCount when present, else the page count when
 *     pagination is exhausted (cursor === null), and `null` otherwise so
 *     callers don't mistake a per-page count for a workspace total.
 *   • Counts serialize BEFORE the items array (key insertion order is
 *     serialization order), so a client that truncates the tail of a large
 *     payload cuts items, never the completeness signals.
 */
export function wrapV2List<T>(
  key: string,
  result: V2ListEnvelope<T> | null | undefined,
  requestedCursor?: unknown,
): Record<string, unknown> {
  const items = Array.isArray(result?.data) ? (result!.data as T[]) : [];
  const cursor = result?.pagination?.cursor ?? null;
  const totalCount = result?.pagination?.totalCount;
  // Drata omits pagination.totalCount on pages after the first, so on the
  // LAST page of a cursor walk (cursor exhausts to null) items.length is the
  // page size, not the universe. Only infer total from items.length when the
  // caller did not pass a cursor — i.e. this single response IS the universe.
  return {
    total:
      typeof totalCount === "number"
        ? totalCount
        : cursor === null && !requestedCursor
          ? items.length
          : null,
    returned: items.length,
    pagination: result?.pagination ?? { cursor: null },
    [key]: items,
  };
}

// The documents LIST endpoints crash upstream (HTTP 500, code 10010) on ANY
// `expand` value — even a bogus one, even on an empty list. The OpenAPI ref
// documents `expand[]=downloadUrl` there, but it is broken; downloadUrl only
// works on the single-document GET. Strip expand before listing, and never let
// a raw 500 surface — reframe it as a clear, non-retryable client error.
function stripDocumentListExpand(
  params?: DrataQueryParams,
): DrataQueryParams | undefined {
  if (!params || params.expand === undefined) return params;
  const rest: DrataQueryParams = { ...params };
  delete rest.expand;
  return rest;
}

function documentListError(err: unknown): DrataClientResponse<unknown> {
  const mapped = catchError(err);
  if (mapped.httpStatus === 500) {
    return {
      isError: true,
      error:
        "Drata returned an internal error listing documents. The documents list endpoint does not support `expand` (including downloadUrl). Omit it; to obtain a download URL, fetch the single document with the matching get_…_document tool and expand: [\"downloadUrl\"].",
      ...(mapped.drataCode !== undefined && { drataCode: mapped.drataCode }),
      httpStatus: 422,
      retryable: false,
    };
  }
  return mapped;
}

function wrapDocumentList<T>(
  result: (V2ListEnvelope<T> & { documents?: T[] }) | null | undefined,
  requestedCursor?: unknown,
): Record<string, unknown> {
  if (Array.isArray(result?.documents)) {
    return wrapV2List(
      "documents",
      { data: result.documents, pagination: result.pagination },
      requestedCursor,
    );
  }
  return wrapV2List("documents", result, requestedCursor);
}

/**
 * Standard envelope for fully auto-merged V2 list responses (fetchAllV2).
 * Workspace count IS knowable here because every page has been walked, so
 * `total === returned === items.length`. Counts serialize BEFORE the items
 * array so tail-truncating clients cut items, never the completeness signal.
 */
export function wrapV2Merged<T>(key: string, items: T[]): Record<string, unknown> {
  return { total: items.length, returned: items.length, [key]: items };
}

/**
 * Several V2 sub-resource lists return HTTP 200 with an empty list when the
 * PARENT id does not exist, making "no items" indistinguishable from "bad
 * id". When such a list comes back empty, lead with a note pointing at the
 * loud existence check so callers don't assert absence from a typo'd id.
 */
function withEmptyParentGuard(
  envelope: Record<string, unknown>,
  itemsKey: string,
  note: string,
): Record<string, unknown> {
  const items = envelope[itemsKey];
  if (Array.isArray(items) && items.length === 0) {
    return { note, ...envelope };
  }
  return envelope;
}

/**
 * Map over `items` with at most `concurrency` calls in flight (a local
 * pLimit-style worker pool — no new deps). Results keep input order.
 * Used by fan-out aggregations so one tool call doesn't fire hundreds of
 * parallel Drata requests and trip rate limits.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker),
  );
  return results;
}

/**
 * Run `fn`, retrying exactly once (after a backoff) if it fails with a
 * Drata 429 rate-limit error. Any other failure propagates immediately.
 */
export async function retryOnceOn429<T>(
  fn: () => Promise<T>,
  backoffMs = 2000,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof DrataApiError && err.status === 429)) throw err;
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    return fn();
  }
}

// Drata's nested policy objects carry numeric `policyStatus` enums while the
// top-level `status` field is the string. Map between them so callers don't
// have to memorise the codes.
const POLICY_STATUS_BY_CODE: Record<number, string> = {
  1: "ACTIVE",
  2: "ARCHIVED",
  3: "REPLACED",
  4: "UNACCEPTABLE",
  5: "OUTDATED",
};

function normalizePolicyVersion<T>(version: T): T {
  if (!version || typeof version !== "object") return version;
  const v = version as Record<string, unknown>;
  if (v.policy && typeof v.policy === "object") {
    const p = v.policy as Record<string, unknown>;
    const code = p.policyStatus;
    if (typeof code === "number" && code in POLICY_STATUS_BY_CODE) {
      v.policy = {
        ...p,
        policyStatus: POLICY_STATUS_BY_CODE[code],
        policyStatusCode: code,
      };
    }
  }
  return version;
}

export async function resolvePersonnelIdByEmail(
  email: string,
): Promise<number> {
  const client = getDrataClient();
  // V2 personnel endpoint has no email — must use V1 which nests it under user.
  const items = await client.getPersonnel();
  const lowerEmail = email.toLowerCase();
  const match = items.find(
    (p) => p.user?.email?.toLowerCase() === lowerEmail,
  );
  if (!match) {
    throw new Error(`No personnel found with email "${email}"`);
  }
  return match.id;
}

// Resolve a Drata `userId` from any one of {userId, personnelId, lookupEmail}.
// Drata's V2 write endpoints that target a person (e.g. POST /background-checks)
// key off `userId` — the user record ID — not `personnelId` (the personnel
// record ID). Personnel records carry both fields: `id` is the personnelId
// and `user.id` is the userId. This helper accepts any of the three inputs
// and returns the userId.
export async function resolveUserIdForPersonnel(opts: {
  userId?: number;
  personnelId?: number;
  lookupEmail?: string;
}): Promise<number> {
  if (opts.userId !== undefined) return opts.userId;

  if (opts.lookupEmail) {
    const client = getDrataClient();
    const items = await client.getPersonnel();
    const lower = opts.lookupEmail.toLowerCase();
    const match = items.find((p) => p.user?.email?.toLowerCase() === lower);
    if (!match || !match.user?.id) {
      throw new Error(
        `No personnel found with email "${opts.lookupEmail}" (or matched record has no associated user)`,
      );
    }
    return match.user.id;
  }

  if (opts.personnelId !== undefined) {
    const client = getDrataClient();
    const items = await client.getPersonnel();
    const match = items.find((p) => p.id === opts.personnelId);
    if (!match || !match.user?.id) {
      throw new Error(
        `No personnel found with id ${opts.personnelId} (or matched record has no associated user)`,
      );
    }
    return match.user.id;
  }

  throw new Error("Provide exactly one of: userId, personnelId, lookupEmail");
}

// ── Evidence Library ────────────────────────────────────────────

export async function listEvidenceLibrary(
  workspaceId?: number,
  params?: DrataQueryParams,
  options?: { fields?: string[]; fetchAll?: boolean },
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    if (options?.fetchAll) {
      const items = await client.fetchAllV2(
        `/public/v2/workspaces/${wId}/evidence-library`,
        params,
      );
      const projected = options?.fields
        ? projectFields(items as Record<string, unknown>[], options.fields)
        : items;
      return { isError: false, result: wrapV2Merged("items", projected) };
    }
    // Default is ONE size-capped page with the real workspace total. Merging
    // every item runs past 100k characters on a library of a few hundred
    // items, and truncating MCP clients cut the list mid-array. fetchAll opts
    // back in.
    const explicitPage = Boolean(
      params?.cursor || params?.size || params?.includeTotalCount,
    );
    const query: DrataQueryParams = {
      ...params,
      size: params?.size ?? 50,
      includeTotalCount: params?.includeTotalCount ?? true,
    };
    const result = await client.getV2<V2ListEnvelope<unknown>>(
      `/public/v2/workspaces/${wId}/evidence-library`,
      query,
    );
    if (options?.fields && Array.isArray(result.data)) {
      result.data = projectFields(
        result.data as Record<string, unknown>[],
        options.fields,
      );
    }
    const envelope = wrapV2List("items", result, params?.cursor);
    const cursor = result.pagination?.cursor ?? null;
    if (!explicitPage && cursor !== null) {
      return {
        isError: false,
        result: {
          note: `First page only (${String(envelope.returned)} of ${String(envelope.total ?? "?")} items). Page with cursor, or pass fetchAll: true (ideally with fields[]) to merge every page.`,
          ...envelope,
        },
      };
    }
    return { isError: false, result: envelope };
  } catch (err) {
    return catchError(err);
  }
}

export async function getEvidenceLibraryItem(
  workspaceId: number | undefined,
  itemId: number,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    const result = await client.getV2(
      `/public/v2/workspaces/${wId}/evidence-library/${itemId}`,
      params,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function getEvidenceLibraryVersion(
  workspaceId: number | undefined,
  itemId: number,
  versionId: number,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    const result = await client.getV2(
      `/public/v2/workspaces/${wId}/evidence-library/${itemId}/versions/${versionId}`,
      params,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export interface EvidenceLibraryArtifactInput {
  workspaceId?: number;
  name: string;
  description?: string;
  implementationGuidance?: string;
  ownerId?: number;
  controlIds?: number[];
  filedAt?: string;
  renewalScheduleType?: string;
  renewalDate?: string;
  fileBase64?: string;
  fileName?: string;
  url?: string;
  ticketUrl?: string;
}

export type EvidenceLibraryArtifactUpdateInput = Omit<
  EvidenceLibraryArtifactInput,
  "name"
> & {
  itemId: number;
  name?: string;
};

function evidenceLibraryPayload(
  input: Omit<EvidenceLibraryArtifactInput, "name"> & { name?: string },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: input.name,
    description: input.description,
    implementationGuidance: input.implementationGuidance,
    ownerId: input.ownerId,
    controlIds: input.controlIds,
    filedAt: input.filedAt,
    renewalScheduleType: input.renewalScheduleType,
    renewalDate:
      input.renewalScheduleType === "CUSTOM" ? input.renewalDate : undefined,
    base64File: input.fileBase64,
    url: input.url,
    ticketUrl: input.ticketUrl,
  };

  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) delete payload[key];
  }
  return payload;
}

export async function createEvidenceLibraryItem(
  input: EvidenceLibraryArtifactInput,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(input.workspaceId);
    const result = await client.postV2(
      `/public/v2/workspaces/${wId}/evidence-library`,
      evidenceLibraryPayload(input),
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function updateEvidenceLibraryItem(
  input: EvidenceLibraryArtifactUpdateInput,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(input.workspaceId);
    let updateInput = input;
    if (input.renewalScheduleType === undefined) {
      const current = await client.getV2<Record<string, unknown>>(
        `/public/v2/workspaces/${wId}/evidence-library/${input.itemId}`,
      );
      const currentRenewalScheduleType = current.renewalScheduleType;
      const currentRenewalDate = current.renewalDate;
      updateInput = {
        ...input,
        renewalScheduleType:
          typeof currentRenewalScheduleType === "string"
            ? currentRenewalScheduleType
            : input.renewalScheduleType,
        renewalDate:
          input.renewalDate ??
          (typeof currentRenewalDate === "string" ? currentRenewalDate : undefined),
      };
    }
    // Preserve renewal metadata when the caller omits it, but do not inject
    // fallback details like `name`; templated items reject detail changes with
    // 400 code 10000 ("Drata templated evidence details cannot be updated").
    const payload = evidenceLibraryPayload(updateInput);
    const result = await client.putV2(
      `/public/v2/workspaces/${wId}/evidence-library/${input.itemId}`,
      payload,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function deleteEvidenceLibraryItem(
  workspaceId: number | undefined,
  itemId: number,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    await client.deleteV2(`/public/v2/workspaces/${wId}/evidence-library/${itemId}`);
    return { isError: false, result: { deleted: true, itemId } };
  } catch (err) {
    return catchError(err);
  }
}

// ── Controls ────────────────────────────────────────────────────

export async function createControl(
  workspaceId: number | undefined,
  body: Record<string, unknown>,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    const result = await client.postV2(`/public/v2/workspaces/${wId}/controls`, body);
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function modifyControl(
  workspaceId: number | undefined,
  controlId: number,
  body: Record<string, unknown>,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    const result = await client.putV2(`/public/v2/workspaces/${wId}/controls/${controlId}`, body);
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function addControlOwner(
  workspaceId: number | undefined,
  controlId: number,
  userId: number,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    // Drata V2 names this body field `ownerId` (confirmed against the live
    // API: posting `{ userId }` is rejected with "property userId should not
    // exist" / "ownerId should not be empty"). The tool's public input keeps
    // `userId`; we remap only when serializing the request body.
    const result = await client.postV2(
      `/public/v2/workspaces/${wId}/controls/${controlId}/owners`,
      { ownerId: userId },
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function modifyControlOwners(
  workspaceId: number | undefined,
  controlId: number,
  userIds: number[],
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    // Drata V2 names this body field `ownerUserIds` (confirmed against the
    // live API: putting `{ userIds }` is rejected with "property userIds
    // should not exist" / "ownerUserIds must be an array"). The tool's public
    // input keeps `userIds`; we remap only when serializing the request body.
    const result = await client.putV2(
      `/public/v2/workspaces/${wId}/controls/${controlId}/owners`,
      { ownerUserIds: userIds },
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function removeControlOwner(
  workspaceId: number | undefined,
  controlId: number,
  ownerId: number,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    await client.deleteV2(
      `/public/v2/workspaces/${wId}/controls/${controlId}/owners/${ownerId}`,
    );
    return { isError: false, result: { deleted: true, ownerId } };
  } catch (err) {
    return catchError(err);
  }
}

export async function listControlOwners(
  workspaceId: number | undefined,
  controlId: number,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    const result = await client.getV2<V2ListEnvelope<unknown>>(
      `/public/v2/workspaces/${wId}/controls/${controlId}/owners`,
    );
    return { isError: false, result: wrapV2List("controlOwners", result) };
  } catch (err) {
    return catchError(err);
  }
}

export async function createControlNote(
  workspaceId: number | undefined,
  controlId: number,
  comment: string,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    const result = await client.postV2(
      `/public/v2/workspaces/${wId}/controls/${controlId}/notes`,
      { comment },
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function updateControlNote(
  workspaceId: number | undefined,
  controlId: number,
  noteId: string,
  comment: string,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    const result = await client.putV2(
      `/public/v2/workspaces/${wId}/controls/${controlId}/notes/${noteId}`,
      { comment },
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function deleteControlNote(
  workspaceId: number | undefined,
  controlId: number,
  noteId: string,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    await client.deleteV2(
      `/public/v2/workspaces/${wId}/controls/${controlId}/notes/${noteId}`,
    );
    return { isError: false, result: { deleted: true, noteId } };
  } catch (err) {
    return catchError(err);
  }
}

export async function listControlNotes(
  workspaceId: number | undefined,
  controlId: number,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    const notes = await client.fetchAllV2(
      `/public/v2/workspaces/${wId}/controls/${controlId}/notes`,
    );
    return { isError: false, result: wrapV2Merged("notes", notes) };
  } catch (err) {
    return catchError(err);
  }
}

// ── Risk Registers ──────────────────────────────────────────────

export async function listRiskRegisters(): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.getV2<V2ListEnvelope<unknown>>(
      `/public/v2/risk-registers`,
    );
    return { isError: false, result: wrapV2List("riskRegisters", result) };
  } catch (err) {
    return catchError(err);
  }
}

export async function createRiskRegister(
  body: Record<string, unknown>,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.postV2(`/public/v2/risk-registers`, body);
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function updateRiskRegister(
  riskRegisterId: number,
  body: Record<string, unknown>,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.putV2(`/public/v2/risk-registers/${riskRegisterId}`, body);
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function uploadRiskDocument(
  riskRegisterId: number | undefined,
  riskId: number | string,
  file: Uint8Array,
  fileName: string,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const rId = client.resolveRiskRegisterId(riskRegisterId);
    const result = await client.submitForm(
      `/public/v2/risk-registers/${rId}/risks/${riskId}/documents`,
      "POST",
      {},
      { fieldName: "files", bytes: file, fileName },
      "Drata V2 risk document upload error",
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function listRiskDocuments(
  riskRegisterId: number | undefined,
  riskId: number | string,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const rId = client.resolveRiskRegisterId(riskRegisterId);
    const result = await client.getV2<V2ListEnvelope<unknown>>(
      `/public/v2/risk-registers/${rId}/risks/${riskId}/documents`,
      stripDocumentListExpand(params),
    );
    return { isError: false, result: wrapV2List("riskDocuments", result, params?.cursor) };
  } catch (err) {
    return documentListError(err);
  }
}

export async function createRiskNote(
  riskRegisterId: number | undefined,
  riskId: number,
  comment: string,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const rId = client.resolveRiskRegisterId(riskRegisterId);
    const result = await client.postV2(
      `/public/v2/risk-registers/${rId}/risks/${riskId}/notes`,
      { comment },
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function updateRiskNote(
  riskRegisterId: number | undefined,
  riskId: number,
  noteId: string,
  comment: string,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const rId = client.resolveRiskRegisterId(riskRegisterId);
    const result = await client.putV2(
      `/public/v2/risk-registers/${rId}/risks/${riskId}/notes/${noteId}`,
      { comment },
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function listRiskNotes(
  riskRegisterId: number | undefined,
  riskId: number,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const rId = client.resolveRiskRegisterId(riskRegisterId);
    const result = await client.getV2<V2ListEnvelope<unknown>>(
      `/public/v2/risk-registers/${rId}/risks/${riskId}/notes`,
      params,
    );
    return {
      isError: false,
      result: withEmptyParentGuard(
        wrapV2List("riskNotes", result, params?.cursor),
        "riskNotes",
        `Drata returns an empty 200 for nonexistent riskIds too. riskId here is the INTERNAL numeric id, not the "R-0xx" display code — resolve/verify riskId ${riskId} with get_risk (which accepts display codes and 404s loudly).`,
      ),
    };
  } catch (err) {
    return catchError(err);
  }
}

// ── Risks (V2) ─────────────────────────────────────────────────

// Cache any risk register id observed in a base-tier risk payload, so callers
// can read risks without ever touching the Pro-gated list_risk_registers.
function rememberRiskRegisterFromRecord(record: unknown): void {
  if (!record || typeof record !== "object") return;
  const r = record as Record<string, unknown>;
  if (typeof r.riskRegisterId === "number") {
    getDrataClient().rememberRiskRegisterId(r.riskRegisterId);
    return;
  }
  const nested = r.riskRegister;
  if (nested && typeof nested === "object") {
    const id = (nested as Record<string, unknown>).id;
    if (typeof id === "number") getDrataClient().rememberRiskRegisterId(id);
  }
}

export async function listRisks(
  riskRegisterId: number | undefined,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const rId = client.resolveRiskRegisterId(riskRegisterId);
    const result = await client.getV2<V2ListEnvelope<unknown>>(
      `/public/v2/risk-registers/${rId}/risks`,
      params,
    );
    if (Array.isArray(result.data)) result.data.forEach(rememberRiskRegisterFromRecord);
    return { isError: false, result: wrapV2List("risks", result, params?.cursor) };
  } catch (err) {
    return catchError(err);
  }
}

export async function getRisk(
  riskRegisterId: number | undefined,
  riskId: number | string,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const rId = client.resolveRiskRegisterId(riskRegisterId);
    const result = await client.getV2(
      `/public/v2/risk-registers/${rId}/risks/${riskId}`,
      params,
    );
    rememberRiskRegisterFromRecord(result);
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function createRisk(
  riskRegisterId: number | undefined,
  body: Record<string, unknown>,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const rId = client.resolveRiskRegisterId(riskRegisterId);
    const result = await client.postV2(
      `/public/v2/risk-registers/${rId}/risks`,
      body,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function updateRisk(
  riskRegisterId: number | undefined,
  riskId: number | string,
  body: Record<string, unknown>,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const rId = client.resolveRiskRegisterId(riskRegisterId);
    const result = await client.putV2(
      `/public/v2/risk-registers/${rId}/risks/${riskId}`,
      body,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function getRiskInsights(
  riskRegisterId: number | undefined,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const rId = client.resolveRiskRegisterId(riskRegisterId);
    const result = await client.getV2(
      `/public/v2/risk-registers/${rId}/insights`,
      params,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

// ── Tasks (V2) ─────────────────────────────────────────────────

export async function listTasks(
  workspaceId: number | undefined,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    const result = await client.getV2<V2ListEnvelope<unknown>>(
      `/public/v2/workspaces/${wId}/tasks`,
      params,
    );
    return { isError: false, result: wrapV2List("tasks", result, params?.cursor) };
  } catch (err) {
    return catchError(err);
  }
}

export async function listUpcomingTasks(
  workspaceId: number | undefined,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  // Defaults resolved AFTER the spread (same pattern as listEventsV2 and
  // listFrameworkRequirements): the tool layer forwards explicit
  // `undefined` for omitted args, so `{ status: "INCOMPLETE", ...params }`
  // would let those undefineds clobber every default and a bare
  // list_upcoming_tasks would behave like an unfiltered list_tasks.
  // Deliberately NO dueDateFrom default: silently starting at today hid
  // OVERDUE incomplete tasks — the ones a caller asking "what's outstanding?"
  // most needs to see.
  const response = await listTasks(workspaceId, {
    ...params,
    sort: params?.sort ?? "dueDate",
    sortDir: params?.sortDir ?? "ASC",
    status: params?.status ?? "INCOMPLETE",
  });
  if (response.isError || params?.dueDateFrom !== undefined) return response;
  return {
    isError: false,
    result: {
      note: "Includes OVERDUE incomplete tasks (sorted by due date, oldest first). Pass dueDateFrom/dueDateTo to bound the window.",
      ...(response.result as Record<string, unknown>),
    },
  };
}

export async function getTask(
  workspaceId: number | undefined,
  taskId: number,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    const result = await client.getV2(
      `/public/v2/workspaces/${wId}/tasks/${taskId}`,
      params,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function createTask(
  workspaceId: number | undefined,
  body: Record<string, unknown>,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    const result = await client.postV2(
      `/public/v2/workspaces/${wId}/tasks`,
      body,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function updateTask(
  workspaceId: number | undefined,
  taskId: number,
  body: Record<string, unknown>,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    const result = await client.putV2(
      `/public/v2/workspaces/${wId}/tasks/${taskId}`,
      body,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function performTaskAction(
  workspaceId: number | undefined,
  taskId: number,
  action: "complete" | "uncomplete",
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    const result = await client.postV2(
      `/public/v2/workspaces/${wId}/tasks/${taskId}/actions`,
      { action },
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

// ── Audits and Audit Requests (V2) ────────────────────────────

export async function listAudits(
  workspaceId?: number,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    // NOTE: the audits list has no includeTotalCount param in Drata's spec.
    if (params?.cursor || params?.size) {
      const result = await client.getV2<V2ListEnvelope<unknown>>(
        `/public/v2/workspaces/${wId}/audits`,
        params,
      );
      return { isError: false, result: wrapV2List("audits", result, params?.cursor) };
    }
    const items = await client.fetchAllV2(
      `/public/v2/workspaces/${wId}/audits`,
      params,
    );
    return { isError: false, result: wrapV2Merged("audits", items) };
  } catch (err) {
    return catchError(err);
  }
}

export async function getAudit(
  workspaceId: number | undefined,
  auditId: string,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    const result = await client.getV2(
      `/public/v2/workspaces/${wId}/audits/${auditId}`,
      params,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function listAuditRequests(
  workspaceId: number | undefined,
  auditId: string,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    const result = await client.getV2<V2ListEnvelope<unknown>>(
      `/public/v2/workspaces/${wId}/audits/${auditId}/requests`,
      params,
    );
    return { isError: false, result: wrapV2List("auditRequests", result, params?.cursor) };
  } catch (err) {
    return catchError(err);
  }
}

export async function getAuditRequest(
  workspaceId: number | undefined,
  auditId: string,
  requestId: number,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    const result = await client.getV2(
      `/public/v2/workspaces/${wId}/audits/${auditId}/requests/${requestId}`,
      params,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

// ── Operational documents, users, roles, and custom data (V2) ──

export async function listUserDocuments(
  userId: number | string,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.getV2<V2ListEnvelope<unknown> & { documents?: unknown[] }>(
      `/public/v2/users/${userId}/documents`,
      stripDocumentListExpand(params),
    );
    return {
      isError: false,
      result: withEmptyParentGuard(
        wrapDocumentList(result, params?.cursor),
        "documents",
        `Drata returns an empty 200 for nonexistent userIds too — verify userId ${userId} with get_user. Note: userId is the USER-record id (list_personnel's userId field), not the personnel id; the two id spaces overlap.`,
      ),
    };
  } catch (err) {
    return documentListError(err);
  }
}

export async function getUserDocument(
  userId: number | string,
  documentId: number,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.getV2(
      `/public/v2/users/${userId}/documents/${documentId}`,
      params,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function listEntityDocuments(
  entity: "devices" | "vendors" | "risk-registers",
  entityId: number | string | undefined,
  params?: DrataQueryParams,
  riskId?: number | string,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const resolvedEntityId =
      entity === "risk-registers"
        ? client.resolveRiskRegisterId(
            entityId === undefined ? undefined : Number(entityId),
          )
        : entityId;
    const path =
      entity === "risk-registers"
        ? `/public/v2/risk-registers/${resolvedEntityId}/risks/${riskId}/documents`
        : `/public/v2/${entity}/${resolvedEntityId}/documents`;
    const result = await client.getV2<V2ListEnvelope<unknown> & { documents?: unknown[] }>(
      path,
      stripDocumentListExpand(params),
    );
    const emptyNote =
      entity === "risk-registers"
        ? `Drata returns an empty 200 for nonexistent risk ids too — verify riskId ${String(riskId)} with get_risk before concluding it has no documents.`
        : `Drata returns an empty 200 for nonexistent ${entity === "vendors" ? "vendor" : "device"} ids too — verify id ${String(resolvedEntityId)} with ${entity === "vendors" ? "get_vendor" : "get_device"} before concluding it has no documents.`;
    return {
      isError: false,
      result: withEmptyParentGuard(wrapDocumentList(result, params?.cursor), "documents", emptyNote),
    };
  } catch (err) {
    return documentListError(err);
  }
}

export async function getEntityDocument(
  entity: "devices" | "vendors" | "risk-registers",
  entityId: number | string | undefined,
  documentId: number,
  params?: DrataQueryParams,
  riskId?: number | string,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const resolvedEntityId =
      entity === "risk-registers"
        ? client.resolveRiskRegisterId(
            entityId === undefined ? undefined : Number(entityId),
          )
        : entityId;
    const path =
      entity === "risk-registers"
        ? `/public/v2/risk-registers/${resolvedEntityId}/risks/${riskId}/documents/${documentId}`
        : `/public/v2/${entity}/${resolvedEntityId}/documents/${documentId}`;
    const result = await client.getV2(path, params);
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function listRoles(
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.getV2<V2ListEnvelope<unknown>>(
      `/public/v2/roles`,
      params,
    );
    return { isError: false, result: wrapV2List("roles", result, params?.cursor) };
  } catch (err) {
    return catchError(err);
  }
}

export async function getRole(
  roleId: number | string,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.getV2(`/public/v2/roles/${roleId}`, params);
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function listUsers(
  params?: DrataQueryParams,
  roleId?: number | string,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const path = roleId ? `/public/v2/roles/${roleId}/users` : `/public/v2/users`;
    const result = await client.getV2<V2ListEnvelope<unknown>>(path, params);
    return { isError: false, result: wrapV2List("users", result, params?.cursor) };
  } catch (err) {
    return catchError(err);
  }
}

export async function getUserV2(
  userId: number | string,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.getV2(`/public/v2/users/${userId}`, params);
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function listCustomDataRecords(
  connectionId: number,
  resourceId: number,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.getV2<V2ListEnvelope<unknown>>(
      `/public/v2/custom-connections/${connectionId}/resources/${resourceId}/records`,
      params,
    );
    return { isError: false, result: wrapV2List("records", result, params?.cursor) };
  } catch (err) {
    return catchError(err);
  }
}

export async function upsertCustomDataRecords(
  connectionId: number,
  resourceId: number,
  data: unknown,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.postV2(
      `/public/v2/custom-connections/${connectionId}/resources/${resourceId}/records`,
      { data },
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function listCustomDataSessions(
  connectionId: number,
  resourceId: number,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.getV2<V2ListEnvelope<unknown>>(
      `/public/v2/custom-connections/${connectionId}/resources/${resourceId}/sessions`,
      params,
    );
    return { isError: false, result: wrapV2List("sessions", result, params?.cursor) };
  } catch (err) {
    return catchError(err);
  }
}

export async function upsertCustomDataRecordsSession(
  connectionId: number,
  resourceId: number,
  sessionId: string,
  data: unknown,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.postV2(
      `/public/v2/custom-connections/${connectionId}/resources/${resourceId}/sessions/${sessionId}`,
      { data },
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function performCustomDataSessionAction(
  connectionId: number,
  resourceId: number,
  sessionId: string,
  action: "complete" | "cancel",
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.postV2(
      `/public/v2/custom-connections/${connectionId}/resources/${resourceId}/sessions/${sessionId}/actions`,
      { action },
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function updateCustomDataRecord(
  connectionId: number,
  resourceId: number,
  recordId: string,
  data: Record<string, unknown>,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.putV2(
      `/public/v2/custom-connections/${connectionId}/resources/${resourceId}/records/${recordId}`,
      { data },
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function deleteCustomDataRecord(
  connectionId: number,
  resourceId: number,
  recordId: string,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    await client.deleteV2(
      `/public/v2/custom-connections/${connectionId}/resources/${resourceId}/records/${recordId}`,
    );
    return { isError: false, result: { deleted: true, recordId } };
  } catch (err) {
    return catchError(err);
  }
}

// ── Vendor Enhancements (V2) ───────────────────────────────────

export async function createVendorSecurityReview(
  vendorId: number,
  body: Record<string, unknown>,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.postV2(
      `/public/v2/vendors/${vendorId}/security-reviews`,
      body,
    );
    // Local-state persistence of review IDs is retired: reviews are now
    // discoverable via GET /public/v2/vendors/{vendorId}/security-reviews.
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function listVendorSecurityReviews(
  vendorId: number,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    if (params?.cursor || params?.size || params?.includeTotalCount) {
      const result = await client.getV2<V2ListEnvelope<unknown>>(
        `/public/v2/vendors/${vendorId}/security-reviews`,
        params,
      );
      return { isError: false, result: wrapV2List("securityReviews", result, params?.cursor) };
    }
    const items = await client.fetchAllV2(
      `/public/v2/vendors/${vendorId}/security-reviews`,
      params,
    );
    return { isError: false, result: wrapV2Merged("securityReviews", items) };
  } catch (err) {
    return catchError(err);
  }
}

export async function getVendorSecurityReview(
  vendorId: number,
  securityReviewId: number,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.getV2(
      `/public/v2/vendors/${vendorId}/security-reviews/${securityReviewId}`,
      params,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

// 🧪 beta endpoint — mirrors listPolicyActions shaping (fetch-all + envelope).
export async function listSecurityReviewActions(
  vendorId: number,
  securityReviewId: number,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const items = await client.fetchAllV2(
      `/public/v2/vendors/${vendorId}/security-reviews/${securityReviewId}/actions`,
    );
    return { isError: false, result: wrapV2Merged("actions", items) };
  } catch (err) {
    return catchError(err);
  }
}

// 🧪 beta endpoint — questionnaires attached to one security review.
export async function listSecurityReviewQuestionnaires(
  vendorId: number,
  securityReviewId: number,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const path = `/public/v2/vendors/${vendorId}/security-reviews/${securityReviewId}/security-questionnaires`;
    if (params?.cursor || params?.size || params?.includeTotalCount) {
      const result = await client.getV2<V2ListEnvelope<unknown>>(path, params);
      return { isError: false, result: wrapV2List("questionnaires", result, params?.cursor) };
    }
    const items = await client.fetchAllV2(path, params);
    return { isError: false, result: wrapV2Merged("questionnaires", items) };
  } catch (err) {
    return catchError(err);
  }
}

export async function getVendorQuestionnaire(
  vendorId: number,
  questionnaireId: number,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.getV2(
      `/public/v2/vendors/${vendorId}/questionnaires/${questionnaireId}`,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function createVendorSecurityReviewWithFile(
  vendorId: number,
  file: Uint8Array,
  fileName: string,
  extraFields?: Record<string, string>,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.uploadFileV2(
      `/public/v2/vendors/${vendorId}/security-reviews/with-file`,
      file,
      fileName,
      extraFields,
    );
    // Local-state persistence of review IDs is retired: reviews are now
    // discoverable via GET /public/v2/vendors/{vendorId}/security-reviews.
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function sendVendorQuestionnaire(
  vendorId: number,
  body: Record<string, unknown>,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.postV2(
      `/public/v2/vendors/${vendorId}/questionnaires`,
      body,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function listVendorQuestionnaires(
  vendorId: number,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.getV2<V2ListEnvelope<unknown>>(
      `/public/v2/vendors/${vendorId}/questionnaires`,
    );
    return {
      isError: false,
      result: withEmptyParentGuard(
        wrapV2List("questionnaires", result),
        "questionnaires",
        `Drata returns an empty 200 for nonexistent vendorIds too — verify vendorId ${vendorId} with get_vendor before concluding this vendor has no questionnaires.`,
      ),
    };
  } catch (err) {
    return catchError(err);
  }
}

export async function createVendorType(
  body: Record<string, unknown>,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.postV2(`/public/v2/vendor-types`, body);
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function listVendorTypes(): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.getV2<V2ListEnvelope<unknown>>(
      `/public/v2/vendor-types`,
    );
    return { isError: false, result: wrapV2List("vendorTypes", result) };
  } catch (err) {
    return catchError(err);
  }
}

// ── Personnel (V2) ─────────────────────────────────────────────

export async function listPersonnelV2(
  params?: Record<string, string>,
  options?: { fields?: string[] },
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const q = params?.q?.toLowerCase();
    // The V2 /public/v2/personnel endpoint returns stub records with only
    // id, employmentStatus, and userId — no name/email/roles. We must use
    // the V1 endpoint which includes the full nested user object.
    const items = await client.getPersonnel();
    const flattened = items.map(flattenPersonnel);
    const filtered = q
      ? flattened.filter(
          (p) =>
            (p.firstName?.toLowerCase().includes(q) ?? false) ||
            (p.lastName?.toLowerCase().includes(q) ?? false) ||
            `${p.firstName ?? ""} ${p.lastName ?? ""}`.toLowerCase().includes(q) ||
            (p.email?.toLowerCase().includes(q) ?? false),
        )
      : flattened;
    // Compact by default (drop the heavy backgroundChecks[]/documents[] arrays,
    // keep counts) and apply the optional fields projection, matching
    // list_personnel — otherwise a large org overflows the MCP output cap.
    const personnel = projectFields(
      filtered.map((p) => compactPersonnel(p, options?.fields)),
      options?.fields,
    );
    return { isError: false, result: { total: personnel.length, personnel } };
  } catch (err) {
    return catchError(err);
  }
}

export async function updatePersonnel(
  personnelId: number,
  body: Record<string, unknown>,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.putV2(`/public/v2/personnel/${personnelId}`, body);
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function createBackgroundCheck(
  body: Record<string, unknown>,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.postV2(`/public/v2/background-checks`, body);
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function uploadOffboardingDocument(
  userId: number,
  file: Uint8Array,
  fileName: string,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.uploadFileV2(
      `/public/v2/users/${userId}/documents`,
      file,
      fileName,
      { type: "OFFBOARDING_EVIDENCE" },
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

// ── Connections (V2) ────────────────────────────────────────────

export async function listCustomConnections(): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.getV2<V2ListEnvelope<unknown>>(
      `/public/v2/custom-connections`,
    );
    return { isError: false, result: wrapV2List("customConnections", result) };
  } catch (err) {
    return catchError(err);
  }
}

export async function createCustomConnection(
  body: Record<string, unknown>,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.postV2(`/public/v2/custom-connections`, body);
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function pushConnectionRecords(
  connectionId: number,
  resourceId: number,
  data: Record<string, unknown>,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.postV2(
      `/public/v2/custom-connections/${connectionId}/resources/${resourceId}/records`,
      { data },
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

// ── Monitoring (V2) ────────────────────────────────────────────

export async function listMonitoringTestsV2(
  workspaceId?: number,
  params?: DrataQueryParams,
  options?: { fetchAll?: boolean },
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    if (options?.fetchAll) {
      const items = await client.fetchAllV2(
        `/public/v2/workspaces/${wId}/monitoring-tests`,
        params,
      );
      return { isError: false, result: wrapV2Merged("tests", items) };
    }
    // Default is ONE size-capped page with the real workspace total. Merging
    // every test (roughly 500 characters each) runs to tens of thousands of
    // characters on a large workspace, and truncating MCP clients cut the list
    // mid-array with the counts in the cut tail.
    const explicitPage = Boolean(
      params?.cursor || params?.size || params?.includeTotalCount,
    );
    const query: DrataQueryParams = {
      ...params,
      size: params?.size ?? 50,
      includeTotalCount: params?.includeTotalCount ?? true,
    };
    const result = await client.getV2<V2ListEnvelope<unknown>>(
      `/public/v2/workspaces/${wId}/monitoring-tests`,
      query,
    );
    const envelope = wrapV2List("tests", result, params?.cursor);
    const cursor = result.pagination?.cursor ?? null;
    if (!explicitPage && cursor !== null) {
      return {
        isError: false,
        result: {
          note: `First page only (${String(envelope.returned)} of ${String(envelope.total ?? "?")} tests). Page with cursor, or pass fetchAll: true to merge every page.`,
          ...envelope,
        },
      };
    }
    return { isError: false, result: envelope };
  } catch (err) {
    return catchError(err);
  }
}

// The monitoring-test object exposes BOTH a workspace-scoped `testId` (the
// path id, a small integer) and an internal `id` (the same id surfaced by
// list_monitors / check_monitors). The two integer namespaces OVERLAP: a
// number can be one test's `testId` and an unrelated test's monitor `id` at
// the same time. Worse, the /failures endpoint returns HTTP 200 with an empty
// list for some testIds that don't exist in the workspace at all, so a
// probe-then-fallback-on-404 strategy silently returns the wrong (or an
// empty) test's failures. The only sound approach is to resolve the caller's
// id against the workspace test list BEFORE fetching anything.
interface MonitoringTestRef {
  id?: unknown;
  testId?: unknown;
  name?: unknown;
  checkResultStatus?: unknown;
}

interface ResolvedTestRef {
  testId: number;
  monitorId: number | null;
  testName: string | null;
  checkResultStatus: string | null;
  resolvedFromMonitorId?: number;
  ambiguityNote?: string;
}

function describeTest(t: MonitoringTestRef): {
  name: string | null;
  status: string | null;
} {
  return {
    name: typeof t.name === "string" ? t.name : null,
    status:
      typeof t.checkResultStatus === "string" ? t.checkResultStatus : null,
  };
}

async function resolveTestRef(
  client: ReturnType<typeof getDrataClient>,
  wId: number,
  ref: { testId?: number; monitorId?: number },
): Promise<ResolvedTestRef | { error: string }> {
  if ((ref.testId === undefined) === (ref.monitorId === undefined)) {
    return {
      error:
        "Provide exactly one of `testId` (the workspace-scoped testId from list_monitoring_tests_v2) or `monitorId` (the monitor id surfaced by list_monitors / check_monitors / the monitoring-test `id` field).",
    };
  }
  const toNum = (v: unknown): number => (typeof v === "number" ? v : Number(v));
  const tests = await client.fetchAllV2<MonitoringTestRef>(
    `/public/v2/workspaces/${wId}/monitoring-tests`,
  );

  if (ref.monitorId !== undefined) {
    const byMonitorId = tests.find((t) => toNum(t.id) === ref.monitorId);
    if (!byMonitorId || byMonitorId.testId == null) {
      return {
        error: `No monitoring test found with monitor id ${ref.monitorId} in workspace ${wId}. Monitor ids are the \`id\` values from list_monitors / check_monitors / list_monitoring_tests_v2.`,
      };
    }
    const { name, status } = describeTest(byMonitorId);
    return {
      testId: toNum(byMonitorId.testId),
      monitorId: ref.monitorId,
      testName: name,
      checkResultStatus: status,
      resolvedFromMonitorId: ref.monitorId,
    };
  }

  const requestedId = ref.testId as number;
  const byTestId = tests.find((t) => toNum(t.testId) === requestedId);
  const byMonitorId = tests.find((t) => toNum(t.id) === requestedId);
  if (byTestId) {
    const { name, status } = describeTest(byTestId);
    const collision =
      byMonitorId && byMonitorId !== byTestId
        ? `Note: ${requestedId} is a valid testId ("${name ?? "?"}") but is ALSO the monitor id of a different test ("${describeTest(byMonitorId).name ?? "?"}", testId ${String(byMonitorId.testId)}). This response is for testId ${requestedId}. If you meant the monitor, call again with monitorId: ${requestedId}.`
        : undefined;
    return {
      testId: requestedId,
      monitorId: byTestId.id != null ? toNum(byTestId.id) : null,
      testName: name,
      checkResultStatus: status,
      ambiguityNote: collision,
    };
  }
  if (byMonitorId && byMonitorId.testId != null) {
    const { name, status } = describeTest(byMonitorId);
    return {
      testId: toNum(byMonitorId.testId),
      monitorId: requestedId,
      testName: name,
      checkResultStatus: status,
      resolvedFromMonitorId: requestedId,
    };
  }
  return {
    error:
      `No monitoring test found for id ${requestedId}. Pass the workspace-scoped \`testId\` ` +
      `from list_monitoring_tests_v2 (the small workspace-scoped testId field), or pass the monitor \`id\` ` +
      `surfaced by list_monitors / check_monitors as \`monitorId\`.`,
  };
}

export async function getMonitoringTest(
  workspaceId: number | undefined,
  testId: number | undefined,
  monitorId?: number,
): Promise<DrataClientResponse<unknown>> {
  const client = getDrataClient();
  try {
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    const resolved = await resolveTestRef(client, wId, { testId, monitorId });
    if ("error" in resolved) {
      return { isError: true, error: resolved.error, httpStatus: 404 };
    }
    const result = await client.getV2(
      `/public/v2/workspaces/${wId}/monitoring-tests/${resolved.testId}`,
    );
    if (resolved.resolvedFromMonitorId === undefined && !resolved.ambiguityNote) {
      return { isError: false, result };
    }
    return {
      isError: false,
      result: {
        ...(resolved.resolvedFromMonitorId !== undefined && {
          resolvedFromMonitorId: resolved.resolvedFromMonitorId,
          resolvedTestId: resolved.testId,
        }),
        ...(resolved.ambiguityNote && { ambiguityNote: resolved.ambiguityNote }),
        test: result,
      },
    };
  } catch (err) {
    return catchError(err);
  }
}

export async function listMonitoringTestFailures(
  workspaceId: number | undefined,
  testId: number | undefined,
  monitorId?: number,
): Promise<DrataClientResponse<unknown>> {
  const client = getDrataClient();
  try {
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    const resolved = await resolveTestRef(client, wId, { testId, monitorId });
    if ("error" in resolved) {
      return { isError: true, error: resolved.error, httpStatus: 404 };
    }
    const items = await client.fetchAllV2(
      `/public/v2/workspaces/${wId}/monitoring-tests/${resolved.testId}/failures`,
    );
    return {
      isError: false,
      result: {
        // The failures payload is not self-identifying, so echo which test it
        // belongs to — a caller can always verify it got the intended test.
        testId: resolved.testId,
        monitorId: resolved.monitorId,
        testName: resolved.testName,
        checkResultStatus: resolved.checkResultStatus,
        ...(resolved.resolvedFromMonitorId !== undefined && {
          resolvedFromMonitorId: resolved.resolvedFromMonitorId,
          resolvedTestId: resolved.testId,
        }),
        ...(resolved.ambiguityNote && { ambiguityNote: resolved.ambiguityNote }),
        ...wrapV2Merged("failures", items),
      },
    };
  } catch (err) {
    return catchError(err);
  }
}

// ── Compliance read (V2) ───────────────────────────────────────

export async function listFrameworks(
  workspaceId?: number,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    const result = await client.getV2<V2ListEnvelope<unknown>>(
      `/public/v2/workspaces/${wId}/frameworks`,
    );
    return { isError: false, result: wrapV2List("frameworks", result) };
  } catch (err) {
    return catchError(err);
  }
}

// Requirement records carry multi-KB COSO guidance prose in additionalInfo*
// (PI1.1 alone is ~3k chars) — trimmed by default, opt back in via fields[].
const FRAMEWORK_REQUIREMENT_HEAVY_FIELDS = [
  "additionalInfo",
  "additionalInfo2",
  "additionalInfo3",
] as const;

export async function listFrameworkRequirements(
  workspaceId?: number,
  params?: DrataQueryParams,
  options?: { fields?: string[] },
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);

    // The endpoint's frameworkId query param is silently IGNORED upstream
    // (any value — even a nonexistent id — returns the full unscoped list).
    // So the filter must be honest client-side: validate the id against the
    // workspace's frameworks (loud error listing available ids, same as the
    // readiness rollup) and filter returned items on the framework's tag/slug.
    const frameworkFilter = params?.frameworkId;
    let wantedTags: string[] | null = null;
    let workspaceFrameworkCount = 0;
    if (frameworkFilter !== undefined) {
      const frameworks = await client.getV2<V2ListEnvelope<FrameworkReadinessFields>>(
        `/public/v2/workspaces/${wId}/frameworks`,
      );
      const rows = frameworks.data ?? [];
      workspaceFrameworkCount = rows.length;
      const match = rows.find((f) => Number(f.id) === Number(frameworkFilter));
      if (!match) {
        const available = rows
          .map((f) => `${f.id} (${String(f.tag ?? f.slug ?? "?")})`)
          .join(", ");
        return {
          isError: true,
          error: `No framework with id ${String(frameworkFilter)} in workspace ${wId}. Available: ${available || "none"}`,
        };
      }
      wantedTags = [match.tag, match.slug]
        .filter((v): v is string => typeof v === "string")
        .map(normalizeTag);
    }

    // Single-page fetch with size=20 default — auto-merge produced 1MB+
    // responses, and even 50 requirements (~18 lines each) overshot 40KB.
    // The tool layer forwards `size: undefined` for default calls, so we
    // can't write `{ size: 20, ...params }` — the spread would clobber
    // the default with `undefined` and Drata would return its own
    // (much larger) server default. Resolve `size` last so undefined
    // falls through to 20. includeTotalCount defaults on so `total` is the
    // real workspace count instead of null.
    const query: DrataQueryParams = {
      ...params,
      size: params?.size ?? 20,
      includeTotalCount: params?.includeTotalCount ?? true,
    };
    const result = await client.getV2<V2ListEnvelope<Record<string, unknown>>>(
      `/public/v2/workspaces/${wId}/framework-requirements`,
      query,
    );
    let items = Array.isArray(result.data) ? result.data : [];
    if (wantedTags !== null) {
      const wanted = wantedTags;
      items = items.filter((r) => {
        const tag = r.frameworkTag ?? r.frameworkSlug;
        return tag != null && wanted.includes(normalizeTag(String(tag)));
      });
    }
    const fields = options?.fields;
    result.data =
      fields && fields.includes("*")
        ? items
        : fields && fields.length > 0
          ? projectFields(items, fields)
          : items.map((r) => {
              const copy: Record<string, unknown> = { ...r };
              for (const f of FRAMEWORK_REQUIREMENT_HEAVY_FIELDS) delete copy[f];
              return copy;
            });
    const envelope = wrapV2List("requirements", result, params?.cursor);
    const notes: string[] = [];
    if (wantedTags !== null) {
      notes.push(
        "frameworkId is ignored by the upstream endpoint; the id was validated and this page was filtered client-side on the framework's tag.",
      );
      if (workspaceFrameworkCount > 1) {
        // pagination.totalCount spans ALL frameworks, so it is not this
        // framework's total.
        envelope.total = null;
        notes.push(
          "total is unknown when filtering one of several frameworks — walk pagination.cursor to enumerate.",
        );
      }
    }
    return {
      isError: false,
      result:
        notes.length > 0 ? { note: notes.join(" "), ...envelope } : envelope,
    };
  } catch (err) {
    return catchError(err);
  }
}

// V2 `expand` collections arrive either as a bare array or as an envelope
// `{ data: [...], totalCount }` — normalize both, and report truncation
// (Drata caps inline expansions, e.g. at 10 controls per requirement).
function readExpandCollection(raw: unknown): {
  items: Record<string, unknown>[];
  truncated: boolean;
} {
  if (Array.isArray(raw)) return { items: raw, truncated: false };
  if (raw && typeof raw === "object") {
    const envelope = raw as { data?: unknown; totalCount?: unknown };
    const data = Array.isArray(envelope.data)
      ? (envelope.data as Record<string, unknown>[])
      : [];
    const totalCount =
      typeof envelope.totalCount === "number" ? envelope.totalCount : data.length;
    return { items: data, truncated: totalCount > data.length };
  }
  return { items: [], truncated: false };
}

interface MappedControl {
  id: number;
  code: unknown;
  isReady: boolean;
  archived: boolean;
  detail: V2Control;
}

interface AnalyzedRequirement {
  liveControls: MappedControl[];
  archivedControls: MappedControl[];
  isInScope: boolean;
  isReady: boolean;
}

// Scope and readiness the way the Drata app computes them (verified against
// GET /workspaces/{w}/frameworks numInScopeRequirements /
// numReadyInScopeRequirements): a requirement is OUT of scope when every
// control mapped to it is archived, and an in-scope requirement is ready when
// it has at least one live mapped control and all of them are ready.
function analyzeRequirement(mapped: MappedControl[]): AnalyzedRequirement {
  const liveControls = mapped.filter((c) => !c.archived);
  const archivedControls = mapped.filter((c) => c.archived);
  const isInScope = mapped.length === 0 || liveControls.length > 0;
  const isReady =
    isInScope && liveControls.length > 0 && liveControls.every((c) => c.isReady);
  return { liveControls, archivedControls, isInScope, isReady };
}

interface FrameworkReadinessFields {
  id?: unknown;
  slug?: unknown;
  tag?: unknown;
  isReady?: unknown;
  numInScopeControls?: unknown;
  numInScopeRequirements?: unknown;
  numReadyInScopeRequirements?: unknown;
}

export async function getFrameworkRequirementReadinessRollup(
  workspaceId?: number,
  params?: DrataQueryParams,
  options?: { includeControlDetail?: boolean },
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const wId = await client.resolveOrFetchWorkspaceId(workspaceId);
    const reqPath = `/public/v2/workspaces/${wId}/framework-requirements`;
    const frameworkFilter = params?.frameworkId;

    // Drata's own framework rollup — the same numbers the app header shows.
    // Fetched for cross-checking; also identifies the framework's tag so the
    // requirement walk can be scoped client-side (the endpoint's frameworkId
    // param is silently ignored on at least some tenants).
    let drataReported: FrameworkReadinessFields | null = null;
    if (frameworkFilter !== undefined) {
      const frameworks = await client.getV2<V2ListEnvelope<FrameworkReadinessFields>>(
        `/public/v2/workspaces/${wId}/frameworks`,
      );
      drataReported =
        (frameworks.data ?? []).find((f) => Number(f.id) === Number(frameworkFilter)) ??
        null;
      if (!drataReported) {
        const available = (frameworks.data ?? [])
          .map((f) => `${f.id} (${String(f.tag ?? f.slug ?? "?")})`)
          .join(", ");
        return {
          isError: true,
          error: `No framework with id ${String(frameworkFilter)} in workspace ${wId}. Available: ${available || "none"}`,
        };
      }
    }
    // Client-side scoping is the only reliable framework filter: the
    // endpoint's frameworkId param is silently ignored on some tenants. A
    // requirement missing both tag fields cannot be attributed to any
    // framework, so it is EXCLUDED (and reported) rather than silently
    // counted into every framework's totals.
    let requirementsWithoutFrameworkTag = 0;
    const matchesFramework = (requirement: Record<string, unknown>): boolean => {
      if (!drataReported) return true;
      const tag = requirement.frameworkTag ?? requirement.frameworkSlug;
      if (tag === undefined || tag === null) {
        requirementsWithoutFrameworkTag++;
        return false;
      }
      const wanted = [drataReported.tag, drataReported.slug]
        .filter((v): v is string => typeof v === "string")
        .map(normalizeTag);
      return wanted.includes(normalizeTag(String(tag)));
    };

    // The requirement→controls mapping is built from ONE walk of the V2
    // controls list with expand=requirements. The requirement-side
    // expand=controls is capped at 10 inline controls per requirement (a SOC 2
    // requirement can map 30+), which would silently compute readiness from a
    // subset; the control side is complete (verified: reverse-mapped counts
    // equal every requirement's expand totalCount). It also replaces the
    // deprecated per-requirement V1 controls?requirementId fan-out.
    const controlExpands = options?.includeControlDetail
      ? [...V2_CONTROL_EXPANDS, "requirements"]
      : ["flags", "requirements"];
    const size = typeof params?.size === "number" ? params.size : 25;
    const [allControls, rawRequirements, page] = await Promise.all([
      client.fetchAllV2<V2Control & { requirements?: unknown }>(
        `/public/v2/workspaces/${wId}/controls`,
        { expand: controlExpands, size: 100 },
      ),
      client.fetchAllV2<Record<string, unknown>>(reqPath, {
        frameworkId: frameworkFilter,
        size: 100,
      }),
      // The detailed page is fetched separately so the caller's opaque server
      // cursor keeps working.
      client.getV2<V2ListEnvelope<Record<string, unknown>>>(reqPath, {
        frameworkId: frameworkFilter,
        cursor: params?.cursor,
        size,
        includeTotalCount: params?.includeTotalCount,
      }),
    ]);
    const byRequirement = new Map<number, MappedControl[]>();
    let controlSideTruncated = false;
    for (const control of allControls) {
      const { items: reqRefs, truncated } = readExpandCollection(control.requirements);
      if (truncated) controlSideTruncated = true;
      const mapped: MappedControl = {
        id: control.id,
        code: control.code,
        isReady: control.flags?.isReady === true,
        archived: control.archivedAt != null,
        detail: control,
      };
      for (const ref of reqRefs) {
        const reqId = Number(ref.id);
        if (!Number.isFinite(reqId)) continue;
        const list = byRequirement.get(reqId) ?? [];
        list.push(mapped);
        byRequirement.set(reqId, list);
      }
    }

    const allRequirements = rawRequirements.filter(matchesFramework);
    // Snapshot before the detail-page filter below reuses matchesFramework,
    // so the reported count covers the full walk exactly once.
    const untaggedExcludedInWalk = requirementsWithoutFrameworkTag;
    const analyzedAll = allRequirements.map((r) =>
      analyzeRequirement(byRequirement.get(Number(r.id)) ?? []),
    );
    const inScopeCount = analyzedAll.filter((a) => a.isInScope).length;
    const readyCount = analyzedAll.filter((a) => a.isReady).length;
    const frameworkReadiness = {
      readinessSource: "v2-controls-expand-requirements",
      totalRequirements: allRequirements.length,
      inScopeRequirements: inScopeCount,
      outOfScopeRequirements: allRequirements.length - inScopeCount,
      readyRequirements: readyCount,
      notReadyRequirements: inScopeCount - readyCount,
      // Drata's own numbers for the same framework (the app header). If these
      // disagree with the derived counts, both are surfaced rather than masked.
      drataReported: drataReported
        ? {
            isReady: drataReported.isReady,
            numInScopeControls: drataReported.numInScopeControls,
            numInScopeRequirements: drataReported.numInScopeRequirements,
            numReadyInScopeRequirements: drataReported.numReadyInScopeRequirements,
          }
        : null,
      matchesDrataReported: drataReported
        ? Number(drataReported.numInScopeRequirements) === inScopeCount &&
          Number(drataReported.numReadyInScopeRequirements) === readyCount
        : null,
      ...(controlSideTruncated && {
        warning:
          "Drata truncated at least one control's expanded requirements list (totalCount > returned); some control→requirement mappings may be missing from this rollup.",
      }),
      ...(untaggedExcludedInWalk > 0 && {
        untaggedRequirementsExcluded: untaggedExcludedInWalk,
        untaggedNote:
          "Requirements carrying neither frameworkTag nor frameworkSlug cannot be attributed to the requested framework and were excluded from these totals.",
      }),
    };

    // The per-requirement control detail is the heavy part of the payload, so
    // it is paged (size caps it; default 25) and the controls are projected to
    // compact fields unless includeControlDetail is requested.
    const pageRequirements = (Array.isArray(page.data) ? page.data : []).filter(
      matchesFramework,
    );

    const rollup = pageRequirements.map((requirement) => {
      const analyzed = analyzeRequirement(byRequirement.get(Number(requirement.id)) ?? []);
      return {
        id: requirement.id,
        name: requirement.name,
        code: requirement.code ?? requirement.externalId ?? requirement.name,
        frameworkName: requirement.frameworkName,
        frameworkTag: requirement.frameworkTag,
        isInScope: analyzed.isInScope,
        isReady: analyzed.isReady,
        controlCount: analyzed.liveControls.length,
        archivedControlCount: analyzed.archivedControls.length,
        readyControlCount: analyzed.liveControls.filter((c) => c.isReady).length,
        notReadyControlCount: analyzed.liveControls.filter((c) => !c.isReady).length,
        controls: analyzed.liveControls.map((control) =>
          options?.includeControlDetail
            ? (enrichV2Control(control.detail) as unknown as Record<string, unknown>)
            : { code: control.code, isReady: control.isReady },
        ),
      };
    });

    const cursor = page.pagination?.cursor ?? null;
    return {
      isError: false,
      // Counts, pagination, and notes serialize BEFORE the heavy
      // requirements array so tail truncation can't remove them.
      result: {
        mappingSource: "v2-controls-expand-requirements",
        framework: frameworkReadiness,
        requirementsInResponse: rollup.length,
        controlDetail: options?.includeControlDetail ? "full" : "compact",
        scopeNote:
          "framework.* counts cover the whole framework and match the app: a requirement is out of scope when all its mapped controls are archived, and ready when all its live mapped controls are ready. requirements[] is one page; archived mapped controls are excluded from controls[] and counted in archivedControlCount. Page via pagination.cursor; pass includeControlDetail for full control objects (use a small size).",
        pagination: page.pagination ?? { cursor: null },
        total: cursor === null ? rollup.length : null,
        requirements: rollup,
      },
    };
  } catch (err) {
    return catchError(err);
  }
}

// Full device objects carry large nested firewall/encryption blobs; dumping
// every device overflows the MCP token cap. By default we project each device
// to these compact, compliance-relevant scalars. Callers override with an
// explicit `fields` list, request everything with `fields: ["*"]`, and/or page
// with `cursor`/`size`.
const COMPACT_DEVICE_FIELDS = [
  "id",
  "name",
  "personnelId",
  "lastCheckedAt",
  "encryptionEnabled",
  "firewallEnabled",
  "antivirusEnabled",
  "autoUpdateEnabled",
  "passwordManagerEnabled",
  "screenLockTime",
  "osVersion",
  "model",
  "serialNumber",
];
// On the default (full-fleet) path we count over every device but only inline a
// bounded sample, so the response stays under the output cap at any fleet size.
const INLINE_DEVICE_LIMIT = 50;
const INLINE_NONREPORTING_LIMIT = 50;

function projectDevices(
  items: Record<string, unknown>[],
  fields?: string[],
): unknown[] {
  if (fields && fields.includes("*")) return items;
  return projectFields(items, fields && fields.length > 0 ? fields : COMPACT_DEVICE_FIELDS);
}

function summarizeDevices(
  items: Record<string, unknown>[],
  maxNonReporting?: number,
) {
  // Devices report telemetry under `*Enabled` boolean fields. A device that
  // hasn't checked in recently OR has every telemetry field null can't satisfy
  // device-compliance monitors — surface that explicitly.
  const RECENT_MS = 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const isRecent = (d: Record<string, unknown>): boolean => {
    const lastChecked = d.lastCheckedAt as string | null | undefined;
    if (!lastChecked) return false;
    const t = Date.parse(lastChecked);
    return Number.isFinite(t) && now - t <= RECENT_MS;
  };
  const TELEMETRY_FIELDS = [
    "encryptionEnabled",
    "firewallEnabled",
    "antivirusEnabled",
    "autoUpdateEnabled",
    "passwordManagerEnabled",
    "screenLockTime",
    "osVersion",
    "model",
    "serialNumber",
  ] as const;
  const hasTelemetry = (d: Record<string, unknown>): boolean =>
    TELEMETRY_FIELDS.some((f) => d[f] !== null && d[f] !== undefined);
  const isReporting = (d: Record<string, unknown>): boolean =>
    isRecent(d) && hasTelemetry(d);
  const truthy = (d: Record<string, unknown>, k: string) => d[k] === true;

  const nonReportingAll = items
    .filter((d) => !isReporting(d))
    .map((d) => ({
      id: d.id,
      personnelId: d.personnelId ?? null,
      lastCheckedAt: d.lastCheckedAt ?? null,
    }));
  const nonReportingDevices =
    maxNonReporting !== undefined
      ? nonReportingAll.slice(0, maxNonReporting)
      : nonReportingAll;

  return {
    totalDevices: items.length,
    devicesReporting: items.filter(isReporting).length,
    devicesWithEncryption: items.filter((d) => truthy(d, "encryptionEnabled")).length,
    devicesWithScreenLock: items.filter(
      (d) => d.screenLockTime !== null && d.screenLockTime !== undefined,
    ).length,
    devicesWithAntivirus: items.filter((d) => truthy(d, "antivirusEnabled")).length,
    devicesWithPasswordManager: items.filter((d) =>
      truthy(d, "passwordManagerEnabled"),
    ).length,
    devicesWithAutoUpdates: items.filter((d) => truthy(d, "autoUpdateEnabled")).length,
    devicesWithFirewall: items.filter((d) => truthy(d, "firewallEnabled")).length,
    nonReportingDeviceCount: nonReportingAll.length,
    ...(nonReportingAll.length > 0 && {
      nonReportingNote:
        "Non-reporting entries may belong to former employees or service accounts — resolve each personnelId's owner and employmentStatus via list_personnel before treating them as compliance gaps.",
    }),
    nonReportingDevices,
  };
}

export async function listDevicesV2(
  params?: DrataQueryParams,
  options?: { fields?: string[] },
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const paged =
      params?.cursor !== undefined ||
      params?.size !== undefined ||
      params?.includeTotalCount !== undefined;

    if (paged) {
      const result = await client.getV2<V2ListEnvelope<Record<string, unknown>>>(
        `/public/v2/devices`,
        params,
      );
      const items = Array.isArray(result.data) ? result.data : [];
      const cursor = result.pagination?.cursor ?? null;
      const totalCount = result.pagination?.totalCount;
      return {
        isError: false,
        result: {
          scope: "page",
          summaryScopeNote:
            "Summary counts cover this page only. Omit cursor/size for a full-fleet summary.",
          returned: items.length,
          // Mid-walk pages must not report page length as the universe (see
          // wrapV2List): only trust an explicit totalCount, or a cursor-less
          // single-page result.
          total:
            typeof totalCount === "number"
              ? totalCount
              : cursor === null && !params?.cursor
                ? items.length
                : null,
          pagination: result.pagination ?? { cursor: null },
          ...summarizeDevices(items),
          devices: projectDevices(items, options?.fields),
        },
      };
    }

    const items = await client.fetchAllV2<Record<string, unknown>>(
      `/public/v2/devices`,
      params,
    );
    // Summary covers the whole fleet; the inline device sample is bounded so a
    // large fleet can't overflow the output cap. Page the full list with size.
    const sample = items.slice(0, INLINE_DEVICE_LIMIT);
    const truncated = items.length > sample.length;
    return {
      isError: false,
      result: {
        scope: "all",
        total: items.length,
        returned: sample.length,
        devicesShown: sample.length,
        devicesTruncated: truncated,
        ...(truncated && {
          devicesNote: `Showing the first ${sample.length} of ${items.length} devices; summary counts cover all. Pass size (and cursor) to page the full fleet, or fields to customise.`,
        }),
        ...summarizeDevices(items, INLINE_NONREPORTING_LIMIT),
        devices: projectDevices(sample, options?.fields),
      },
    };
  } catch (err) {
    return catchError(err);
  }
}

export async function listPoliciesV2(
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const items = await client.fetchAllV2(`/public/v2/policies`, params);
    return { isError: false, result: wrapV2Merged("policies", items) };
  } catch (err) {
    return catchError(err);
  }
}

export async function getPolicy(
  policyId: number,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.getV2(
      `/public/v2/policies/${policyId}`,
      params,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function getPolicyApprovalConfiguration(
  policyId: number,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.getV2(
      `/public/v2/policies/${policyId}/approval-configuration`,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

// ── Policy Versions (V2) ──────────────────────────────────────

export async function listPolicyVersions(
  policyId: number,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const items = await client.fetchAllV2(
      `/public/v2/policies/${policyId}/policy-versions`,
      params,
    );
    const versions = items.map((v) => normalizePolicyVersion(v));
    return {
      isError: false,
      result: withEmptyParentGuard(
        wrapV2Merged("versions", versions),
        "versions",
        `Drata returns an empty 200 for nonexistent policyIds too — verify policyId ${policyId} with get_policy (which 404s loudly) before concluding this policy has no versions.`,
      ),
    };
  } catch (err) {
    return catchError(err);
  }
}

export async function getPolicyVersion(
  policyId: number,
  policyVersionId: number,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.getV2(
      `/public/v2/policies/${policyId}/policy-versions/${policyVersionId}`,
      params,
    );
    return { isError: false, result: normalizePolicyVersion(result) };
  } catch (err) {
    return catchError(err);
  }
}

export interface PolicyVersionContentResult extends Record<string, unknown> {
  policyId: number;
  policyVersionId: number;
  contentType: string;
  contentChars: number;
  html: string;
}

export async function getPolicyVersionContent(
  policyId: number,
  policyVersionId: number,
): Promise<DrataClientResponse<PolicyVersionContentResult>> {
  try {
    const client = getDrataClient();
    const path = `/public/v2/policies/${policyId}/policy-versions/${policyVersionId}`;
    const html = await client.getV2Text(path);
    // Bare HTML is not self-identifying — fetch the version's JSON metadata
    // so the output states whose content this is and whether it is the
    // published current version or a draft. Metadata failure never blocks
    // the content.
    let meta: Record<string, unknown>;
    try {
      const version = await client.getV2<Record<string, unknown>>(path);
      const policy = (version?.policy ?? {}) as Record<string, unknown>;
      const statusCode = policy.policyStatus;
      meta = {
        policyName: policy.name ?? null,
        policyStatus:
          typeof statusCode === "number"
            ? POLICY_STATUS_BY_CODE[statusCode] ?? statusCode
            : statusCode ?? null,
        version: version?.version ?? null,
        policyVersionStatus: version?.policyVersionStatus ?? null,
        currentVersion: version?.current ?? null,
      };
    } catch {
      meta = {
        metadataNote:
          "Version metadata lookup failed — the html below is unannotated; confirm status/currency via get_policy_version.",
      };
    }
    return {
      isError: false,
      result: {
        policyId,
        policyVersionId,
        ...meta,
        contentType: "text/html",
        contentChars: html.length,
        ...(html.length > 30000 && {
          sizeNote:
            "Large content — clients that cap tool output may truncate the html; the metadata above still identifies what was fetched.",
        }),
        html,
      },
    };
  } catch (err) {
    return catchError(err);
  }
}

// ── Policy Actions (V2) ────────────────────────────────────────

export async function listPolicyActions(
  policyId: number,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const items = await client.fetchAllV2(
      `/public/v2/policies/${policyId}/actions`,
    );
    return { isError: false, result: wrapV2Merged("actions", items) };
  } catch (err) {
    return catchError(err);
  }
}

export async function performPolicyAction(
  policyId: number,
  body: Record<string, unknown>,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.postV2(
      `/public/v2/policies/${policyId}/actions`,
      body,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

// ── User's Assigned Policies (V2) ──────────────────────────────

interface PolicyDirectoryEntry {
  id?: unknown;
  name?: unknown;
  status?: unknown;
  currentVersionId?: unknown;
}

export async function listUserAssignedPolicies(
  userId: number,
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const items = await client.fetchAllV2<Record<string, unknown>>(
      `/public/v2/users/${userId}/assigned-policies`,
      params,
    );
    // Rows are per policy-VERSION assignment, and rows for superseded
    // versions / REPLACED policies keep acceptedAt:null forever. Join the
    // policy directory so a null acceptedAt on a stale row can't be read as
    // an outstanding acknowledgement. Enrichment failure never blocks rows.
    let byPolicyId: Map<number, PolicyDirectoryEntry> | null = null;
    try {
      const policies = await client.fetchAllV2<PolicyDirectoryEntry>(
        `/public/v2/policies`,
      );
      byPolicyId = new Map(
        policies
          .filter((p): p is PolicyDirectoryEntry & { id: number } =>
            typeof p.id === "number",
          )
          .map((p) => [p.id, p]),
      );
    } catch {
      byPolicyId = null;
    }
    type AnnotatedAssignment = Record<string, unknown> & {
      currentVersion: boolean | null;
    };
    const rows: AnnotatedAssignment[] = items.map((r) => {
      const policy =
        byPolicyId && typeof r.policyId === "number"
          ? byPolicyId.get(r.policyId)
          : undefined;
      const currentVersion =
        policy && policy.currentVersionId != null
          ? Number(policy.currentVersionId) === Number(r.policyVersionId)
          : null;
      return {
        ...r,
        policyName: policy?.name ?? null,
        policyStatus: policy?.status ?? null,
        currentVersion,
      };
    });
    const isOutstanding = (r: AnnotatedAssignment): boolean =>
      r.acceptedAt == null &&
      r.currentVersion === true &&
      r.policyStatus === "ACTIVE";
    return {
      isError: false,
      result: {
        total: rows.length,
        returned: rows.length,
        unacknowledgedCurrent: byPolicyId
          ? rows.filter(isOutstanding).length
          : null,
        supersededUnaccepted: byPolicyId
          ? rows.filter((r) => r.acceptedAt == null && !isOutstanding(r)).length
          : null,
        semanticsNote:
          "Rows are per policy-VERSION assignment. acceptedAt: null is only an outstanding acknowledgement when currentVersion is true and policyStatus is ACTIVE; null rows on superseded versions or REPLACED/ARCHIVED policies are historical, not action items.",
        ...(byPolicyId === null && {
          enrichmentNote:
            "Policy directory lookup failed — policyName/policyStatus/currentVersion are null and the unacknowledged counts could not be computed.",
        }),
        assignedPolicies: rows,
      },
    };
  } catch (err) {
    return catchError(err);
  }
}

export async function acknowledgeAssignedPolicy(
  userId: number,
  policyId: number,
  body: { acceptedAt: string; details?: string },
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.postV2(
      `/public/v2/users/${userId}/assigned-policies/${policyId}/action-acknowledge`,
      body,
    );
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}

export async function listEventsV2(
  params?: DrataQueryParams,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    // An unparsable `since` must fail loudly: upstream ignores createdAtFrom
    // entirely and the client-side compensation filter would silently skip,
    // returning the full unfiltered page as if it were time-bounded.
    if (
      params?.createdAtFrom !== undefined &&
      !Number.isFinite(Date.parse(String(params.createdAtFrom)))
    ) {
      return {
        isError: true,
        error: `Unparsable since/createdAtFrom value "${String(params.createdAtFrom)}". Pass an ISO 8601 date (e.g. 2026-07-01 or 2026-07-01T00:00:00Z); refusing to return unfiltered events as if they were time-bounded.`,
      };
    }
    // Single-page fetch with sensible sort/size defaults — auto-merge
    // produced 1.3MB responses spanning every event since workspace
    // creation. Callers iterate via the cursor and refine with `since`.
    // Defaults go AFTER the spread because the tool layer forwards
    // `size: undefined` etc. for default calls; if defaults came first
    // they'd be clobbered by undefined and Drata would use its own
    // server defaults (e.g. unbounded result set, arbitrary order).
    const query: DrataQueryParams = {
      ...params,
      size: params?.size ?? 50,
      sort: params?.sort ?? "createdAt",
      sortDir: params?.sortDir ?? "DESC",
    };
    const result = await client.getV2<V2ListEnvelope<Record<string, unknown>>>(
      `/public/v2/events`,
      query,
    );
    if (params?.createdAtFrom && Array.isArray(result.data)) {
      const from = Date.parse(String(params.createdAtFrom));
      if (Number.isFinite(from)) {
        result.data = result.data.filter((event) => {
          const createdAt = Date.parse(String(event.createdAt ?? ""));
          return Number.isFinite(createdAt) && createdAt >= from;
        });
      }
    }
    return { isError: false, result: wrapV2List("events", result, params?.cursor) };
  } catch (err) {
    return catchError(err);
  }
}

export async function listWorkspaces(): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.getV2<V2ListEnvelope<unknown>>(
      `/public/v2/workspaces`,
    );
    return { isError: false, result: wrapV2List("workspaces", result) };
  } catch (err) {
    return catchError(err);
  }
}

export async function getCompany(): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.getV2(`/public/v2/company`);
    return { isError: false, result };
  } catch (err) {
    return catchError(err);
  }
}
