import { z } from "zod";
import { updateEvidenceLibraryItem } from "../../handlers/v2-write.handler.js";
import {
  countArtifactSources,
  validateArtifactMetadata,
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

const UpdateEvidenceLibraryItemTool = CreateDrataTool(
  "update_evidence_library_item",
  "Update an existing evidence library item. Optionally replace the artifact source with exactly one of fileBase64, url, or ticketUrl. The handler fetches and preserves the current renewal schedule when renewalScheduleType is omitted, because Drata resets renewal to NONE otherwise. Note: templated evidence items (those with an evidenceTemplateCode) reject detail changes (name/description/implementationGuidance) with 400 code 10000, but accept artifact/owner/renewal updates — use fulfil_templated_evidence for those.",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    itemId: z.number().describe("ID of the evidence library item to update"),
    name: z.string().optional().describe("Evidence display name"),
    description: z.string().optional().describe("Updated description"),
    implementationGuidance: z.string().optional().describe("Implementation guidance"),
    ownerId: z.number().optional().describe("Owner user ID"),
    controlIds: z.array(z.number()).optional().describe("Control IDs to map"),
    filedAt: z.string().optional().describe("Original filed/created date"),
    renewalScheduleType: z
      .enum(RENEWAL_SCHEDULE_TYPES)
      .optional()
      .describe("Renewal schedule type"),
    renewalDate: z.string().optional().describe("Evidence renewal date"),
    fileBase64: z.string().optional().describe("Base64-encoded replacement file content"),
    fileName: z.string().optional().describe("Replacement file name"),
    url: z.string().url().optional().describe("Replacement URL evidence source"),
    ticketUrl: z.string().url().optional().describe("Replacement ticket evidence URL"),
  },
  async ({
    workspaceId,
    itemId,
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
    const sourceCount = countArtifactSources({ fileBase64, url, ticketUrl });
    if (sourceCount > 1) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Error: Provide at most one of fileBase64, url, or ticketUrl.",
          },
        ],
      };
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

    const response = await updateEvidenceLibraryItem({
      workspaceId,
      itemId,
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
    });
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default UpdateEvidenceLibraryItemTool;
