import { z } from "zod";
import { listPersonnelV2 } from "../../handlers/v2-write.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ListPersonnelV2Tool = CreateDrataTool(
  "list_personnel_v2",
  "List personnel. `q` filters by a case-insensitive substring of first name, last name, full name, or email (matched locally — the V2 personnel endpoint exposes no name/email, so V1 data is used). A short query like \"a\" matches almost everyone; use a more specific substring to narrow. Compact by default: per-person backgroundChecks[]/documents[] are summarized as counts; use `fields` to project columns or restore the full arrays.",
  {
    q: z
      .string()
      .optional()
      .describe("Case-insensitive name/email substring filter (e.g. \"smith\")."),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Return only these fields per person, e.g. ["id","firstName","lastName","email"]. ' +
          'Include "backgroundChecks" or "documents" to restore the full nested arrays (dropped by default).',
      ),
  },
  async ({ q, fields }) => {
    const params: Record<string, string> = {};
    if (q) params.q = q;
    const response = await listPersonnelV2(params, { fields });
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
  },
);

export default ListPersonnelV2Tool;
