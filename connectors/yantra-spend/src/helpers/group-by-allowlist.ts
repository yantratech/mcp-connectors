import { Source } from "../types/cost-line.js";

/**
 * Per-source allowlist of valid `group_by` axes. Used by spend_by_source to
 * reject unknown axes early with a precise error message rather than letting
 * the source module silently coerce or drop the unsupported value.
 *
 * An empty array (GCP, which is not supported) accepts no grouping.
 */
export const GROUP_BY_ALLOWLIST: Record<Source, ReadonlyArray<string>> = {
  aws: [
    "service",
    "region",
    "account",
    "usage_type",
    "tag:project",
    "tag:env",
    "tag:owner",
  ],
  gcp: [],
  azure: ["service", "resource_group", "resource", "meter", "subscription"],
  anthropic: ["workspace_id", "description"],
  openai: ["project_id", "line_item", "api_key_id"],
  cursor: ["user", "model", "kind"],
};

/**
 * Throws a descriptive error listing the allowed values when `groupBy` is set
 * but not in the per-source allowlist. No-op when `groupBy` is undefined.
 */
export function validateGroupBy(
  source: Source,
  groupBy: string | undefined,
): void {
  if (groupBy === undefined) return;
  const allowed = GROUP_BY_ALLOWLIST[source] ?? [];
  if (!allowed.includes(groupBy)) {
    throw new Error(
      `invalid group_by '${groupBy}' for source '${source}', allowed: ${
        allowed.length > 0 ? allowed.join("|") : "(none)"
      }`,
    );
  }
}
