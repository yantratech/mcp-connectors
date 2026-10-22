import { z } from "zod";
import { listPoliciesV2 } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";
import type { DrataQueryParams } from "../../clients/drata-client.js";

const PolicyStatus = z.enum([
  "ACTIVE",
  "ARCHIVED",
  "REPLACED",
  "UNACCEPTABLE",
  "OUTDATED",
]);

const PolicyExpand = z.enum([
  "groups",
  "weekTimeFrameSlas",
  "gracePeriodSlas",
  "p3MatrixSlas",
  "owner",
]);

const ListPoliciesV2Tool = CreateDrataTool(
  "list_policies_v2",
  "List policies with V2 cursor pagination, filters, and expansions. " +
    "With no `statuses` filter this returns every policy including REPLACED " +
    "and ARCHIVED — that's the difference vs the V1 list_policies tool.",
  {
    name: z.string().optional().describe("Filter by policy name substring"),
    statuses: z
      .array(PolicyStatus)
      .optional()
      .describe("Filter by policy statuses"),
    expand: z
      .array(PolicyExpand)
      .optional()
      .describe("Related fields to expand in the response"),
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
  },
  async ({ name, statuses, expand, size, sort, sortDir }) => {
    const params: DrataQueryParams = {
      name,
      statuses,
      expand,
      size,
      sort,
      sortDir,
    };
    const response = await listPoliciesV2(params);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListPoliciesV2Tool;
