import { z } from "zod";
import { listBlueprintTemplates } from "../../handlers/list-blueprints.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

const ListBlueprintTemplatesTool = CreateKandjiTool(
  "list_blueprint_templates",
  "List Kandji's curated blueprint templates — pre-built starting points for new blueprints (CIS, Compliance, SOC 2, ADE Default, and similar). Idempotent read of GET /blueprints/templates/. Returns { category_count, template_count, templates } — the catalogue is grouped by category with the actual templates nested under templates[].templates[], so template_count (not category_count) is the number of available templates. Each leaf template carries the numeric `id` you pass to create_blueprint as `source_id` (with `source_type=template`) to clone it. Per-template `params` blobs are omitted by default; pass detail: true to include them.",
  {
    max_results: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Cap on template CATEGORY GROUPS returned (not leaf templates — those are nested inside each group).",
      ),
    detail: z
      .boolean()
      .optional()
      .describe(
        "If true, include each template's `params` configuration blob (~1.8k chars per template).",
      ),
  },
  async ({ max_results, detail }) => {
    const response = await listBlueprintTemplates(max_results, detail);
    if (response.isError) {
      return renderToolError(response);
    }
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(response.result, null, 2),
        },
      ],
    };
  },
  { readOnlyHint: true, idempotentHint: true },
);

export default ListBlueprintTemplatesTool;
