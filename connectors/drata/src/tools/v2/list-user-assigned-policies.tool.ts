import { z } from "zod";
import { listUserAssignedPolicies } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";
import type { DrataQueryParams } from "../../clients/drata-client.js";

const ListUserAssignedPoliciesTool = CreateDrataTool(
  "list_user_assigned_policies",
  "List policies assigned to a user with acknowledgement status. Rows are per policy-VERSION: superseded rows keep acceptedAt null forever, so use each row's currentVersion/policyStatus enrichment (and the unacknowledgedCurrent count) — never a bare acceptedAt:null — to identify outstanding acknowledgements.",
  {
    userId: z
      .number()
      .describe(
        "USER-record id (list_personnel's userId field / list_users id) — NOT the personnel record id; the two integer id spaces overlap.",
      ),
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
      .enum(["createdAt", "updatedAt"])
      .optional()
      .describe("Sort field"),
    sortDir: z.enum(["ASC", "DESC"]).optional().describe("Sort direction"),
  },
  async ({ userId, size, sort, sortDir }) => {
    const params: DrataQueryParams = {
      size,
      sort,
      sortDir,
    };
    const response = await listUserAssignedPolicies(userId, params);
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListUserAssignedPoliciesTool;
