import {
  getGitHubClient,
  GitHubApiError,
  GitHubTokenMissingError,
} from "../clients/github-client.js";
import { getDrataClient } from "../clients/drata-client.js";
import type { DrataClientResponse } from "../types/drata-client-response.js";

// Drata holds a GitHub *connection* (org identity + health) but its public API
// does not re-expose raw repository, branch-protection, Dependabot, or
// collaborator data — those must be read directly from GitHub, which needs a
// token. We reuse the Drata connection only to discover the org name so the
// caller doesn't have to supply it, and we surface a precise setup hint when
// the token is missing.

let cachedGitHubOrg: string | null | undefined; // undefined = not yet looked up

async function resolveGitHubOrgFromDrata(): Promise<string | undefined> {
  if (cachedGitHubOrg !== undefined) return cachedGitHubOrg ?? undefined;
  try {
    const connections = await getDrataClient().getConnections();
    const github = connections.find(
      (c) => String((c as { clientType?: unknown }).clientType ?? "").toUpperCase() === "GITHUB",
    );
    const clientId = github
      ? (github as { clientId?: unknown }).clientId
      : undefined;
    // Cache only a deterministic outcome (a found org, or a genuine
    // no-connection null). A transient Drata failure must NOT be cached, or a
    // single blip on the first lookup would disable org derivation for the
    // whole process — so the catch leaves cachedGitHubOrg undefined to retry.
    cachedGitHubOrg = typeof clientId === "string" && clientId ? clientId : null;
    return cachedGitHubOrg ?? undefined;
  } catch {
    return undefined;
  }
}

function githubSetupHint(org?: string): string {
  const orgNote = org
    ? `Drata has a connected GitHub org "${org}", but Drata's public API does not expose raw repository, branch-protection, Dependabot, or collaborator data. `
    : "Drata's public API does not expose raw repository, branch-protection, Dependabot, or collaborator data. ";
  return (
    "GitHub scanning requires a GitHub Personal Access Token. " +
    orgNote +
    "Set the GITHUB_PAT environment variable to a token with read access — classic scopes `repo`, `read:org`, `security_events`; " +
    "or a fine-grained token with Repository permissions Contents:read, Administration:read (branch protection), Metadata:read, and Dependabot alerts:read. " +
    "See README → GitHub Scanning."
  );
}

function githubError(err: unknown, org?: string): DrataClientResponse<never> {
  if (err instanceof GitHubTokenMissingError) {
    return { isError: true, error: githubSetupHint(org) };
  }
  return { isError: true, error: err instanceof Error ? err.message : String(err) };
}

const NO_OWNER_ERROR =
  "Provide `owner` (the repo's user or org). It could not be derived from a Drata GitHub connection.";

export async function scanGitHubRepos(
  org?: string,
): Promise<DrataClientResponse<unknown>> {
  const resolvedOrg = org ?? (await resolveGitHubOrgFromDrata());
  try {
    const client = getGitHubClient();
    const repos = resolvedOrg
      ? await client.listOrgRepos(resolvedOrg)
      : await client.listUserRepos();

    return {
      isError: false,
      result: {
        org: resolvedOrg ?? null,
        orgSource: org
          ? "parameter"
          : resolvedOrg
            ? "drata-connection"
            : "authenticated-user",
        count: repos.length,
        repos: repos.map((r) => ({
          name: r.full_name,
          private: r.private,
          visibility: r.visibility,
          defaultBranch: r.default_branch,
          archived: r.archived,
          url: r.html_url,
        })),
      },
    };
  } catch (err) {
    return githubError(err, resolvedOrg);
  }
}

export async function scanBranchProtection(
  owner: string | undefined,
  repo: string,
  branch?: string,
): Promise<DrataClientResponse<unknown>> {
  const resolvedOwner = owner ?? (await resolveGitHubOrgFromDrata());
  if (!resolvedOwner) return { isError: true, error: NO_OWNER_ERROR };
  try {
    const client = getGitHubClient();
    // No hardcoded "main" fallback — ask GitHub for the repo's actual default
    // branch so older "master" (or custom) repos scan correctly.
    const targetBranch =
      branch || (await client.getRepo(resolvedOwner, repo)).default_branch;

    let protection;
    try {
      protection = await client.getBranchProtection(resolvedOwner, repo, targetBranch);
    } catch (err) {
      // GitHub answers 404 "Branch not protected" when the branch exists but
      // has no protection rules. That is a scan finding, not a tool failure.
      // Other 404s (unknown repo/branch, no access) stay errors.
      if (
        err instanceof GitHubApiError &&
        err.status === 404 &&
        /branch not protected/i.test(err.body)
      ) {
        return {
          isError: false,
          result: { repo: `${resolvedOwner}/${repo}`, branch: targetBranch, protected: false },
        };
      }
      throw err;
    }

    return {
      isError: false,
      result: {
        repo: `${resolvedOwner}/${repo}`,
        branch: targetBranch,
        protected: true,
        requiresStatusChecks: protection.required_status_checks !== null,
        enforceAdmins: protection.enforce_admins?.enabled ?? false,
        requiresPullRequestReviews:
          protection.required_pull_request_reviews !== null,
        requiredApprovers:
          protection.required_pull_request_reviews
            ?.required_approving_review_count ?? 0,
        dismissesStaleReviews:
          protection.required_pull_request_reviews?.dismiss_stale_reviews ?? false,
        requiresCodeOwnerReviews:
          protection.required_pull_request_reviews?.require_code_owner_reviews ??
          false,
        allowForcePushes: protection.allow_force_pushes?.enabled ?? false,
        allowDeletions: protection.allow_deletions?.enabled ?? false,
      },
    };
  } catch (err) {
    return githubError(err, resolvedOwner);
  }
}

export async function scanVulnerabilities(
  owner: string | undefined,
  repo: string,
  state: string = "open",
): Promise<DrataClientResponse<unknown>> {
  const resolvedOwner = owner ?? (await resolveGitHubOrgFromDrata());
  if (!resolvedOwner) return { isError: true, error: NO_OWNER_ERROR };
  try {
    const client = getGitHubClient();
    const alerts = await client.getDependabotAlerts(resolvedOwner, repo, state);

    const bySeverity: Record<string, number> = {};
    for (const alert of alerts) {
      const severity = alert.security_advisory.severity;
      bySeverity[severity] = (bySeverity[severity] || 0) + 1;
    }

    return {
      isError: false,
      result: {
        repo: `${resolvedOwner}/${repo}`,
        state,
        totalAlerts: alerts.length,
        bySeverity,
        alerts: alerts.map((a) => ({
          number: a.number,
          state: a.state,
          severity: a.security_advisory.severity,
          summary: a.security_advisory.summary,
          cve: a.security_advisory.cve_id,
          package: a.dependency.package.name,
          ecosystem: a.dependency.package.ecosystem,
          manifest: a.dependency.manifest_path,
          createdAt: a.created_at,
          fixedAt: a.fixed_at,
        })),
      },
    };
  } catch (err) {
    return githubError(err, resolvedOwner);
  }
}

export async function scanCollaborators(
  owner: string | undefined,
  repo: string,
): Promise<DrataClientResponse<unknown>> {
  const resolvedOwner = owner ?? (await resolveGitHubOrgFromDrata());
  if (!resolvedOwner) return { isError: true, error: NO_OWNER_ERROR };
  try {
    const client = getGitHubClient();
    const collaborators = await client.listCollaborators(resolvedOwner, repo);

    return {
      isError: false,
      result: {
        repo: `${resolvedOwner}/${repo}`,
        count: collaborators.length,
        collaborators: collaborators.map((c) => ({
          login: c.login,
          role: c.role_name,
          permissions: c.permissions,
          url: c.html_url,
        })),
      },
    };
  } catch (err) {
    return githubError(err, resolvedOwner);
  }
}
