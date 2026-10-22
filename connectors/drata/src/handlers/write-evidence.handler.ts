import { readFile } from "fs/promises";
import { getDrataClient } from "../clients/drata-client.js";
import { mapDrataError } from "../helpers/error-mapping.js";
import { validateUploadFilePath } from "./upload-validation.js";
import type { DrataClientResponse } from "../types/drata-client-response.js";

export interface CreateControlExternalEvidenceOptions {
  workspaceId?: number;
  controlId: number;
  filename: string;
  creationDate: string;
  renewalDate: string;
  renewalScheduleType: string;
  description?: string;
  url?: string;
  base64File?: string;
  file?: Uint8Array;
  fileName?: string;
}

export async function uploadUserDocument(
  userId: number,
  filePath: string,
  type: string,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    await validateUploadFilePath(filePath);
    const fileBuffer = await readFile(filePath);
    const fileName = filePath.split("/").pop() || "document.pdf";
    const result = await client.uploadUserDocument(
      userId,
      new Uint8Array(fileBuffer),
      fileName,
      type,
    );
    return { isError: false, result };
  } catch (err) {
    return mapDrataError(err);
  }
}

export async function createControlExternalEvidence(
  options: CreateControlExternalEvidenceOptions,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const workspaceId = await client.resolveOrFetchWorkspaceId(options.workspaceId);
    const result = await client.createControlExternalEvidence({
      workspaceId,
      controlId: options.controlId,
      filename: options.filename,
      creationDate: options.creationDate,
      renewalDate: options.renewalDate,
      renewalScheduleType: options.renewalScheduleType,
      description: options.description,
      url: options.url,
      base64File: options.base64File,
      file: options.file,
      fileName: options.fileName,
    });
    return { isError: false, result };
  } catch (err) {
    return mapDrataError(err);
  }
}

export async function getExternalEvidenceDownloadUrl(
  evidenceId: number,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.getJson(
      `/public/external-evidence/${evidenceId}/download`,
    );
    return { isError: false, result };
  } catch (err) {
    return mapDrataError(err);
  }
}

export async function deleteExternalEvidence(
  evidenceId: number,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const raw = await client.deleteJson(`/public/external-evidence/${evidenceId}`);
    // In DRATA_MCP_DRY_RUN mode the client short-circuits with a sentinel;
    // pass it through instead of fabricating a {deleted: true} success.
    if (raw && typeof raw === "object" && (raw as { dryRun?: boolean }).dryRun) {
      return { isError: false, result: raw };
    }
    return { isError: false, result: { deleted: true, evidenceId } };
  } catch (err) {
    return mapDrataError(err);
  }
}

export async function listControlMappedRequirements(
  controlId: number,
  params?: { page?: number; limit?: number; frameworkTag?: string; frameworkSlug?: string },
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const result = await client.getJson<{
      data?: unknown[];
      page?: number;
      limit?: number;
      total?: number;
    }>(`/public/controls/${controlId}/requirements`, params);
    const requirements = Array.isArray(result?.data) ? result.data : [];
    const empty = requirements.length === 0;
    // Upstream 200-empties for nonexistent controlId, and a bad frameworkSlug
    // silently filters everything out (unlike frameworkTag, which 400s on
    // near-misses) — flag both before a caller asserts "unmapped control".
    const note = empty
      ? "Empty result does not prove the control is unmapped — upstream returns the same 200-empty page for nonexistent controlId" +
        (params?.frameworkSlug
          ? " and for frameworkSlug values that match no framework (bad slugs do not error)"
          : "") +
        ". Verify the control exists via get_control first."
      : undefined;
    return {
      isError: false,
      result: {
        controlId,
        total: result?.total ?? requirements.length,
        page: result?.page ?? params?.page ?? 1,
        limit: result?.limit ?? params?.limit ?? null,
        returned: requirements.length,
        ...(note && { note }),
        requirements,
      },
    };
  } catch (err) {
    return mapDrataError(err);
  }
}

export async function listExternalEvidence(
  controlId: number,
): Promise<DrataClientResponse<unknown>> {
  try {
    const client = getDrataClient();
    const evidence = await client.getExternalEvidence(controlId);
    // Upstream returns 200 with an empty list for nonexistent controlId too —
    // lead with the caveat so "no evidence" is not asserted off a typo'd id.
    const note =
      evidence.length === 0
        ? "Empty result does not prove the control exists — upstream returns the same 200-empty response for nonexistent controlId. Verify the control via get_control before asserting it has no external evidence."
        : undefined;
    return {
      isError: false,
      result: {
        controlId,
        count: evidence.length,
        ...(note && { note }),
        evidence,
      },
    };
  } catch (err) {
    return mapDrataError(err);
  }
}
