import { z } from "zod";
import { getPrismData } from "../../handlers/prism.handler.js";
import { CreateKandjiTool } from "../../helpers/create-kandji-tool.js";
import { renderToolError } from "../../helpers/format-kandji-error.js";

/**
 * Shared schema and handler for the 16 inline Prism category tools.
 *
 * The defaults here exist because each Prism row carries 14 denormalised
 * device columns; even on a very small fleet, apps/local_users/transparency_database
 * routinely exceeded the 25K-token budget. Sane defaults: cap at 50 rows,
 * hoist device columns into a single `devices` map.
 */
export const PRISM_INPUT_SCHEMA = {
  max_results: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Cap on rows returned across pagination. Defaults to 50, or 20 for the per-row fan-out categories (apps, local_users, transparency_database, launch_agents_and_daemons) where the row count multiplies by device. When the cap truncates, the response says so (`truncated: true` + note) — never treat `returned` as the fleet universe.",
    ),
  fields: z
    .array(z.string())
    .optional()
    .describe(
      "Optional projection: only these row keys are returned (device_id is always retained). Field names that don't appear in any row come back in `fields_unknown` so typos can be corrected — e.g. apps rows have `bundle_name`/`bundle_id`, not `app_name`.",
    ),
  summary: z
    .boolean()
    .optional()
    .describe(
      "If true, returns { returned, total_available, truncated, by_device: { id: row_count }, sample: first 3 rows } instead of the full row list. by_device counts reflect ONLY the fetched (capped) rows — check `truncated`, and use prism_count for true per-category totals.",
    ),
};

export const PRISM_RESPONSE_NOTE =
  "Returns { category, returned, total_available, truncated, default_cap_applied?, note?, devices_in_slice, devices: { <device_id>: { name, model, serial_number, ... } }, rows: [{ device_id, ...category-specific cols only }] }. IMPORTANT: `returned` is the row count of THIS response only — rows default-cap at 50 (20 for the fan-out categories apps/local_users/transparency_database/launch_agents_and_daemons), `truncated: true` means more rows exist upstream, and `total_available` is null when the API reports no total (use prism_count for exact per-category universe counts). Rows fill device-by-device, so a truncated response's `devices` map may cover only part of the fleet. Device columns are hoisted to the `devices` map (allowlist + per-device-constant heuristic), so each row carries only category-specific fields. Use `summary: true` for a per-device count view (same cap and truncation signals apply), or `fields: [...]` to project specific row columns; `fields_unknown` is included when a requested field doesn't exist in the row schema.";

export function makePrismTool(
  toolName: string,
  category: string,
  description: string,
) {
  return CreateKandjiTool(
    toolName,
    `${description} ${PRISM_RESPONSE_NOTE}`,
    PRISM_INPUT_SCHEMA,
    async ({ max_results, fields, summary }) => {
      const response = await getPrismData(category, {
        maxResults: max_results,
        fields,
        summary,
      });
      if (response.isError) {
        return renderToolError(response);
      }
      // Compact serialization: prism rows are the connector's largest
      // payloads and pretty-printing adds ~35% for no model benefit.
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(response.result),
          },
        ],
      };
    },
  );
}
