import { z } from "zod";
import { listControls } from "../../handlers/list-entities.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

// The ~200 controls of a typical SOC 2 workspace, pretty-printed
// field-by-field, serialize past 45k chars; keep the leading counts readable
// but emit each control on one compact line so the full list stays inside
// MCP clients' truncation thresholds (same pattern as check_control_status).
function serializeResult(result: unknown): string {
  const { controls, ...head } = result as Record<string, unknown>;
  if (!Array.isArray(controls)) return JSON.stringify(result, null, 2);
  const headJson = JSON.stringify(head, null, 2);
  const rows =
    controls.length === 0
      ? " []"
      : ` [\n${controls.map((c) => `    ${JSON.stringify(c)}`).join(",\n")}\n  ]`;
  return `${headJson.slice(0, -2)},\n  "controls":${rows}\n}`;
}

const ListControlsTool = CreateDrataTool(
  "list_controls",
  "List controls with current status flags, including IDs. Archived (out-of-scope) controls are excluded by default. CAVEAT: hasEvidence here is Drata's narrow V1 flag — only manually uploaded external evidence and evidence-library reports count; evidence from mapped policies and monitor tests does NOT. Use check_control_status for app-equivalent evidence coverage. Use codes[] and fields[] to keep responses compact.",
  {
    frameworkFilter: z
      .string()
      .optional()
      .describe('Filter by framework tag, e.g. "SOC 2"'),
    codes: z
      .array(z.string())
      .optional()
      .describe('Filter by control code, e.g. ["DCF-26", "DCF-21"].'),
    fields: z
      .array(z.string())
      .optional()
      .describe('Return only selected fields, e.g. ["id", "code", "name"].'),
    includeArchived: z
      .boolean()
      .optional()
      .describe(
        "Include archived (out-of-scope) controls; their rows carry isArchived/archivedAt. Default false.",
      ),
  },
  async ({ frameworkFilter, codes, fields, includeArchived }) => {
    const response = await listControls(frameworkFilter, {
      codes,
      fields,
      includeArchived,
    });
    if (response.isError) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
    }
    return { content: [{ type: "text" as const, text: serializeResult(response.result) }] };
  },
);

export default ListControlsTool;
