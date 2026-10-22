import { z } from "zod";
import { updateEvidenceLibraryItem } from "../../handlers/v2-write.handler.js";
import { validateExactlyOneArtifactSource } from "../../helpers/artifact-source.js";
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

const FulfilTemplatedEvidenceTool = CreateDrataTool(
  "fulfil_templated_evidence",
  "Attach an artifact to a Drata templated evidence placeholder (an evidence library item with an evidenceTemplateCode, status NEEDS_ARTIFACT). Sends a minimal PUT with only artifact/owner/renewal fields — templated items reject any name/description/implementationGuidance change with 400 code 10000, but accept artifact attachment. Satisfying the placeholder flips mapped controls to isReady.",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    itemId: z.number().describe("ID of the templated evidence library item"),
    url: z.string().url().optional().describe("URL evidence source"),
    fileBase64: z.string().optional().describe("Base64-encoded file content"),
    fileName: z
      .string()
      .optional()
      .describe("File name (required with fileBase64)"),
    filedAt: z.string().describe("Original filed/created date (YYYY-MM-DD)"),
    renewalScheduleType: z
      .enum(RENEWAL_SCHEDULE_TYPES)
      .describe("Renewal schedule type"),
    renewalDate: z
      .string()
      .optional()
      .describe("Renewal date (required when renewalScheduleType is CUSTOM)"),
    ownerId: z.number().describe("Owner user ID"),
  },
  async ({
    workspaceId,
    itemId,
    url,
    fileBase64,
    fileName,
    filedAt,
    renewalScheduleType,
    renewalDate,
    ownerId,
  }) => {
    const sourceError = validateExactlyOneArtifactSource({ fileBase64, url });
    if (sourceError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Error: Provide exactly one of url or fileBase64.",
          },
        ],
      };
    }
    if (fileBase64 && !fileName) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Error: fileName is required when fileBase64 is provided.",
          },
        ],
      };
    }
    if (renewalScheduleType === "CUSTOM" && !renewalDate) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Error: renewalDate is required when renewalScheduleType is CUSTOM.",
          },
        ],
      };
    }

    const response = await updateEvidenceLibraryItem({
      workspaceId,
      itemId,
      ownerId,
      filedAt,
      renewalScheduleType,
      renewalDate,
      fileBase64,
      fileName,
      url,
    });
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default FulfilTemplatedEvidenceTool;
