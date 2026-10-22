import { z } from "zod";
import {
  deleteExternalEvidence,
  getExternalEvidenceDownloadUrl,
  listControlMappedRequirements,
} from "../../handlers/write-evidence.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

// Drata's response body carries no expiry field, but the presigned S3
// signedUrl embeds its own lifetime in the querystring (X-Amz-Date +
// X-Amz-Expires — observed 60s, enforced by S3 to the second). Surface the
// parsed expiry BEFORE the payload so the link is never presented or stored
// as a durable reference; any expiry field upstream ever adds passes through
// verbatim via the spread.
function annotateSignedUrlExpiry(result: unknown): unknown {
  if (result === null || typeof result !== "object") return result;
  const signedUrl = (result as { signedUrl?: unknown }).signedUrl;
  if (typeof signedUrl !== "string") return result;
  let urlExpiresInSeconds: number | null = null;
  let urlExpiresAt: string | null = null;
  try {
    const query = new URL(signedUrl).searchParams;
    const expires = Number(query.get("X-Amz-Expires"));
    if (Number.isFinite(expires) && expires > 0) {
      urlExpiresInSeconds = expires;
      // X-Amz-Date is compact ISO 8601 UTC, e.g. 20260811T110740Z.
      const signedAt = query
        .get("X-Amz-Date")
        ?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
      if (signedAt) {
        const [, y, mo, d, h, mi, s] = signedAt;
        urlExpiresAt = new Date(
          Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) + expires * 1000,
        ).toISOString();
      }
    }
  } catch {
    // Unparseable URL — fall through to the generic short-lived note.
  }
  return {
    urlExpiresInSeconds,
    urlExpiresAt,
    note:
      urlExpiresInSeconds !== null
        ? `signedUrl is a short-lived presigned link — it expires ${urlExpiresInSeconds}s after signing${urlExpiresAt ? ` (at ${urlExpiresAt})` : ""}. Download immediately; re-call this tool for a fresh URL instead of storing or sharing this one.`
        : "signedUrl is a short-lived presigned link (observed lifetime ~60s). Download immediately; re-call this tool for a fresh URL instead of storing or sharing this one.",
    ...(result as Record<string, unknown>),
  };
}

const GetExternalEvidenceDownloadUrlTool = CreateDrataTool(
  "get_external_evidence_download_url",
  "Get a download URL for external evidence. The returned signedUrl is a short-lived presigned link (observed X-Amz-Expires=60 — dead ~60s after signing): download immediately and re-call for a fresh URL; never store or present it as a durable link.",
  {
    evidenceId: z.number().describe("External evidence ID"),
  },
  async ({ evidenceId }) => {
    const response = await getExternalEvidenceDownloadUrl(evidenceId);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(annotateSignedUrlExpiry(response.result), null, 2) }] };
  },
);

const DeleteExternalEvidenceTool = CreateDrataTool(
  "delete_external_evidence",
  "Delete external evidence by ID.",
  {
    evidenceId: z.number().describe("External evidence ID"),
  },
  async ({ evidenceId }) => {
    const response = await deleteExternalEvidence(evidenceId);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const ListControlMappedRequirementsTool = CreateDrataTool(
  "list_control_mapped_requirements",
  "List framework requirements mapped to a control via Drata V1 `GET /controls/{id}/requirements`. Caveat: upstream returns the same 200-empty page for nonexistent controlId and for bad frameworkSlug values — an empty result is flagged with a note; confirm the control via get_control before asserting it is unmapped.",
  {
    controlId: z.number().describe("Control ID"),
    page: z.number().int().min(1).optional().describe("Page number."),
    limit: z.number().int().min(1).max(50).optional().describe("Page size."),
    frameworkTag: z
      .string()
      .optional()
      .describe("Optional framework tag filter, for example SOC_2."),
    frameworkSlug: z
      .string()
      .optional()
      .describe("Optional custom framework slug filter."),
  },
  async ({ controlId, page, limit, frameworkTag, frameworkSlug }) => {
    const response = await listControlMappedRequirements(controlId, {
      page,
      limit,
      frameworkTag,
      frameworkSlug,
    });
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export const ControlEvidenceLifecycleTools = [
  GetExternalEvidenceDownloadUrlTool,
  DeleteExternalEvidenceTool,
  ListControlMappedRequirementsTool,
];
