import { z } from "zod";
import { listPolicyVersions } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";
import type { DrataQueryParams } from "../../clients/drata-client.js";

const VersionExpand = z.enum([
  "owner",
  "weekTimeFrameSlas",
  "p3MatrixSlas",
  "gracePeriodSlas",
  "downloadUrl",
  "downloadPdfUrl",
]);

const VersionStatus = z.enum([
  "NEEDS_APPROVAL",
  "APPROVED",
  "PUBLISHED",
  "DRAFT",
  "DISCARDED",
]);

const ListPolicyVersionsTool = CreateDrataTool(
  "list_policy_versions",
  "List versions of a policy with V2 cursor pagination.",
  {
    policyId: z.number().describe("ID of the policy"),
    size: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe(
        "Per-request page size (1–500, default 50). All pages are fetched and returned as a single list.",
      ),
    sort: z
      .enum(["createdAt", "updatedAt", "name"])
      .optional()
      .describe("Sort field"),
    sortDir: z.enum(["ASC", "DESC"]).optional().describe("Sort direction"),
    expand: z
      .array(VersionExpand)
      .optional()
      .describe("Related fields to expand"),
    version: z.number().optional().describe("Filter by specific version number"),
    current: z
      .boolean()
      .optional()
      .describe("Filter to only the current version"),
    statuses: z
      .array(VersionStatus)
      .optional()
      .describe("Filter by version statuses"),
  },
  async ({
    policyId,
    size,
    sort,
    sortDir,
    expand,
    version,
    current,
    statuses,
  }) => {
    const params: DrataQueryParams = {
      size,
      sort,
      sortDir,
      expand,
      version,
      current,
      statuses,
    };
    const response = await listPolicyVersions(policyId, params);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListPolicyVersionsTool;
