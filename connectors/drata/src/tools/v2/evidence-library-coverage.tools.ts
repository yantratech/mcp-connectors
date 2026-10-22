import { z } from "zod";
import {
  getEvidenceLibraryItem,
  getEvidenceLibraryVersion,
} from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const buildParams = (expand?: string[]) => (expand ? { expand } : undefined);

// Drata validates this enum upstream (400 otherwise): user, controls,
// renewalSchemaAndVersions.
const EvidenceLibraryItemExpand = z.enum([
  "user",
  "controls",
  "renewalSchemaAndVersions",
]);

const GetEvidenceLibraryItemTool = CreateDrataTool(
  "get_evidence_library_item",
  "Get an evidence library item by ID.",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    itemId: z.number().describe("Evidence library item ID"),
    expand: z
      .array(EvidenceLibraryItemExpand)
      .optional()
      .describe("Related fields to expand: user, controls, renewalSchemaAndVersions"),
  },
  async ({ workspaceId, itemId, expand }) => {
    const response = await getEvidenceLibraryItem(workspaceId, itemId, buildParams(expand));
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

const GetEvidenceLibraryVersionTool = CreateDrataTool(
  "get_evidence_library_version",
  "Get a specific version of an evidence library item.",
  {
    workspaceId: z
      .number()
      .optional()
      .describe("Workspace ID. Defaults to DRATA_WORKSPACE_ID env var."),
    itemId: z.number().describe("Evidence library item ID"),
    versionId: z.number().describe("Evidence library item version ID"),
    expand: z.array(z.string()).optional().describe("Related fields to expand"),
  },
  async ({ workspaceId, itemId, versionId, expand }) => {
    const response = await getEvidenceLibraryVersion(
      workspaceId,
      itemId,
      versionId,
      buildParams(expand),
    );
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export const EvidenceLibraryCoverageTools = [
  GetEvidenceLibraryItemTool,
  GetEvidenceLibraryVersionTool,
];
