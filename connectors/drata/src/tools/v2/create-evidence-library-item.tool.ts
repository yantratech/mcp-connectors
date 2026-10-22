import { z } from "zod";
import { createEvidenceLibraryItem } from "../../handlers/v2-write.handler.js";
import {
  validateArtifactMetadata,
  validateExactlyOneArtifactSource,
} from "../../helpers/artifact-source.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const RENEWAL_SCHEDULE_TYPES = [
  "ONE_MONTH",
  "TWO_MONTHS",
  "THREE_MONTHS",
  "SIX_MONTHS",
  "ONE_YEAR",
  "CUSTOM",
  "NONE",
] as const;

const CreateEvidenceLibraryItemTool = CreateDrataTool(
  "create_evidence_library_item",
  "Create an evidence library item from exactly one artifact source: fileBase64, url, or ticketUrl.",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    name: z
      .string()
      .optional()
      .describe("Evidence display name. Defaults to fileName for backward compatibility."),
    description: z.string().optional().describe("Description of the evidence item"),
    implementationGuidance: z.string().optional().describe("Implementation guidance"),
    ownerId: z.number().optional().describe("Owner user ID"),
    controlIds: z.array(z.number()).optional().describe("Control IDs to map"),
    filedAt: z.string().optional().describe("Original filed/created date"),
    renewalScheduleType: z
      .enum(RENEWAL_SCHEDULE_TYPES)
      .optional()
      .describe("Renewal schedule type"),
    renewalDate: z.string().optional().describe("Evidence renewal date"),
    fileBase64: z.string().optional().describe("Base64-encoded file content to upload"),
    fileName: z
      .string()
      .optional()
      .describe("Original file name. Also used as name if name is omitted."),
    url: z.string().url().optional().describe("URL evidence source"),
    ticketUrl: z.string().url().optional().describe("Ticket provider evidence URL"),
  },
  async ({
    workspaceId,
    name,
    description,
    implementationGuidance,
    ownerId,
    controlIds,
    filedAt,
    renewalScheduleType,
    renewalDate,
    fileBase64,
    fileName,
    url,
    ticketUrl,
  }) => {
    const sourceError = validateExactlyOneArtifactSource({ fileBase64, url, ticketUrl });
    if (sourceError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${sourceError}` }] };
    }
    const metadataError = validateArtifactMetadata({
      fileBase64,
      url,
      ticketUrl,
      ownerId,
      filedAt,
      renewalScheduleType,
      renewalDate,
    });
    if (metadataError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${metadataError}` }] };
    }

    const evidenceName = name ?? fileName;
    if (!evidenceName) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Error: name is required unless fileName is provided.",
          },
        ],
      };
    }

    const response = await createEvidenceLibraryItem({
      workspaceId,
      name: evidenceName,
      description,
      implementationGuidance,
      ownerId,
      controlIds,
      filedAt,
      renewalScheduleType,
      renewalDate,
      fileBase64,
      fileName,
      url,
      ticketUrl,
    });
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default CreateEvidenceLibraryItemTool;
