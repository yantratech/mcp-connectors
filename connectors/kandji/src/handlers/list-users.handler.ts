import { getKandjiClient } from "../clients/kandji-client.js";
import type { KandjiClientResponse } from "../types/kandji-client-response.js";
import { formatKandjiError } from "../helpers/format-kandji-error.js";

export async function listUsers(
  filters: { email?: string } = {},
  maxResults?: number,
): Promise<KandjiClientResponse<unknown>> {
  try {
    const client = getKandjiClient();
    const params: Record<string, string> = {};
    if (filters.email) params.email = filters.email;

    // Probe one row past the cap so a capped result can say that more users
    // exist (the /users envelope carries no total).
    const fetched = await client.listUsers(
      params,
      maxResults === undefined ? undefined : maxResults + 1,
    );
    const truncated = maxResults !== undefined && fetched.length > maxResults;
    const users = truncated ? fetched.slice(0, maxResults) : fetched;

    const archivedCount = users.filter(
      (u) => (u as { archived?: unknown })?.archived === true,
    ).length;
    const notes: string[] = [];
    if (truncated) {
      notes.push(
        `More users exist beyond the max_results cap of ${maxResults} — this count is the capped page size, not the directory size.`,
      );
    }
    if (archivedCount > 0) {
      notes.push(
        `count includes ${archivedCount} archived user(s) (flagged per-record with archived: true) — exclude them when reporting active headcount.`,
      );
    }
    return {
      isError: false,
      result: {
        count: users.length,
        active_count: users.length - archivedCount,
        archived_count: archivedCount,
        ...(truncated ? { truncated: true } : {}),
        ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
        users,
      },
    };
  } catch (err) {
    return formatKandjiError(err);
  }
}
