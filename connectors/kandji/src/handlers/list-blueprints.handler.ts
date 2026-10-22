import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

export async function listBlueprints(
  maxResults?: number,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const blueprints = await client.listBlueprints({}, maxResults);
    return {
      isError: false,
      result: { count: blueprints.length, blueprints },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}

/**
 * /blueprints/templates/ nests leaf templates under category groups
 * (templates[].templates[]). A single leading `count` would count the
 * GROUPS (e.g. 2) — easy to misread as "2 templates available" — so both
 * axes lead explicitly, and the bulky per-leaf `params` blobs (~1.8k chars
 * each) are dropped unless detail is requested.
 */
export async function listBlueprintTemplates(
  maxResults?: number,
  detail?: boolean,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const groups = await client.listBlueprintTemplates(maxResults);
    let templateCount = 0;
    const shaped = groups.map((group) => {
      if (!group || typeof group !== "object" || Array.isArray(group)) {
        return group;
      }
      const record = group as Record<string, unknown>;
      const leaves = Array.isArray(record.templates) ? record.templates : [];
      templateCount += leaves.length;
      if (detail) return record;
      return {
        ...record,
        templates: leaves.map((leaf) => {
          if (!leaf || typeof leaf !== "object" || Array.isArray(leaf)) {
            return leaf;
          }
          const rest = { ...(leaf as Record<string, unknown>) };
          delete rest.params;
          return rest;
        }),
      };
    });
    return {
      isError: false,
      result: {
        category_count: shaped.length,
        template_count: templateCount,
        note: `${templateCount} templates across ${shaped.length} category groups — leaf templates are nested under templates[].templates[].${detail ? "" : " Per-template `params` blobs are omitted; pass detail: true to include them."}`,
        templates: shaped,
      },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}
