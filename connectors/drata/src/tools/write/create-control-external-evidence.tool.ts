import { z } from "zod";
import { createControlExternalEvidence } from "../../handlers/write-evidence.handler.js";
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

const CreateControlExternalEvidenceTool = CreateDrataTool(
  "create_control_external_evidence",
  "Attach external evidence directly to a control via Drata V1 multipart. Provide exactly one artifact source: url or fileBase64. renewalDate is required by this endpoint even for non-CUSTOM schedules. If Drata returns 500 code 10010 after a minimal payload, use create_evidence_library_item with controlIds instead.",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    controlId: z.number().describe("The control ID to attach evidence to"),
    name: z.string().describe("Display name for the evidence"),
    description: z.string().optional().describe("Evidence description"),
    creationDate: z
      .string()
      .describe("Creation date for the evidence, as an ISO 8601 date/time"),
    renewalDate: z
      .string()
      .describe("Renewal date required by the V1 external evidence endpoint."),
    renewalScheduleType: z
      .enum(RENEWAL_SCHEDULE_TYPES)
      .describe("Renewal schedule type for the evidence"),
    url: z
      .string()
      .url()
      .optional()
      .describe("URL to attach as evidence. Mutually exclusive with fileBase64."),
    fileBase64: z
      .string()
      .optional()
      .describe("Base64-encoded file content. Mutually exclusive with url."),
    fileName: z
      .string()
      .optional()
      .describe("Optional original file name for client-side traceability."),
  },
  async ({
    workspaceId,
    controlId,
    name,
    description,
    creationDate,
    renewalDate,
    renewalScheduleType,
    url,
    fileBase64,
    fileName,
  }) => {
    const sourceError = validateExactlyOneArtifactSource({ fileBase64, url });
    if (sourceError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error: ${sourceError.replace(", or ticketUrl", "")}`,
          },
        ],
      };
    }
    const response = await createControlExternalEvidence({
      workspaceId,
      controlId,
      filename: name,
      creationDate,
      renewalDate,
      renewalScheduleType,
      description,
      url,
      base64File: fileBase64,
      fileName,
    });

    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default CreateControlExternalEvidenceTool;
