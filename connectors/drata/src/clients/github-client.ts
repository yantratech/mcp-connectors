/**
 * GitHub REST API client.
 * Authenticates via a Personal Access Token read from GITHUB_PAT env var.
 * Targets https://api.github.com unless GITHUB_API_URL points it at a GitHub
 * Enterprise Server REST root (e.g. https://github.example.com/api/v3).
 */

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch: string;
  visibility: string;
  archived: boolean;
  has_issues: boolean;
  has_wiki: boolean;
  security_and_analysis?: Record<string, { status: string }>;
}

export interface GitHubBranchProtection {
  required_status_checks: { strict: boolean; contexts: string[] } | null;
  enforce_admins: { enabled: boolean } | null;
  required_pull_request_reviews: {
    dismiss_stale_reviews: boolean;
    require_code_owner_reviews: boolean;
    required_approving_review_count: number;
  } | null;
  restrictions: unknown | null;
  required_signatures: { enabled: boolean } | null;
  allow_force_pushes: { enabled: boolean } | null;
  allow_deletions: { enabled: boolean } | null;
}

export interface GitHubAlert {
  number: number;
  state: string;
  dependency: {
    package: { ecosystem: string; name: string };
    manifest_path: string;
  };
  security_advisory: {
    severity: string;
    summary: string;
    cve_id: string | null;
  };
  created_at: string;
  fixed_at: string | null;
}

export interface GitHubCollaborator {
  login: string;
  id: number;
  html_url: string;
  role_name: string;
  permissions: Record<string, boolean>;
}

/**
 * Validate and encode a caller-supplied value before it becomes a path
 * segment in a GitHub API request. owner/org/repo/branch all arrive as
 * free-form z.string() from the tool schemas and are interpolated directly
 * into the request path under the operator's PAT. Without this guard a value
 * containing extra path segments, `?`/`#`, `%`, `..`, or whitespace could
 * redirect the request to a different GitHub endpoint than the tool advertises
 * (path/query injection escaping the intended surface). We reject any such
 * value with a clear error rather than silently encoding it, so the caller
 * learns the input was malformed instead of hitting a baffling 404.
 *
 * The host is fixed by operator configuration (GITHUB_API_URL, default
 * api.github.com) and never by tool input, so this is not arbitrary-host
 * SSRF — it closes the in-host endpoint-escape vector.
 */
function seg(label: string, value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`GitHub ${label} must be a non-empty string`);
  }
  // owner/org logins are [A-Za-z0-9-] and repo names are [A-Za-z0-9._-];
  // none of them may contain a path separator or query/fragment delimiter.
  // Reject `/`, `?`, `#`, `%`, `..`, backslashes, and whitespace outright so a
  // crafted value cannot escape the advertised endpoint, then percent-encode
  // whatever remains.
  if (/[/?#%\\]|\.\.|\s/.test(value)) {
    throw new Error(
      `GitHub ${label} "${value}" contains illegal characters; ` +
        "it must not include /, ?, #, %, .., backslashes, or whitespace",
    );
  }
  return encodeURIComponent(value);
}

/**
 * Encode a branch/ref for use as a path segment. Branch names legitimately
 * contain `/` (e.g. "release/1.0"), so we percent-encode the whole value
 * (encodeURIComponent escapes `/`, `?`, `#`, `%`, whitespace) instead of
 * rejecting slashes — but we still bar `..` traversal, whitespace, and ASCII
 * control chars (0x00-0x1F, 0x7F), which are never valid in a ref here and
 * would only be an endpoint-escape attempt.
 */
function encodeBranch(branch: string): string {
  if (typeof branch !== "string" || branch.length === 0) {
    throw new Error("GitHub branch must be a non-empty string");
  }
  // eslint-disable-next-line no-control-regex
  if (branch.includes("..") || /[\u0000-\u001f\u007f\s]/.test(branch)) {
    throw new Error(
      `GitHub branch "${branch}" contains illegal characters (.. or control/whitespace chars)`,
    );
  }
  return encodeURIComponent(branch);
}

/**
 * A non-2xx response from the GitHub API. `status`, `path` and `body` are
 * typed so callers branch on them (e.g. 404 "Branch not protected") instead
 * of parsing the message, whose `GitHub API error <status> on <path>: <body>`
 * shape is kept for logs and model-facing text.
 */
export class GitHubApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: string,
  ) {
    super(`GitHub API error ${status} on ${path}: ${body}`);
    this.name = "GitHubApiError";
  }
}

/** GITHUB_PAT is unset — callers surface the token setup hint for this. */
export class GitHubTokenMissingError extends Error {
  constructor() {
    super("GITHUB_PAT environment variable is required for GitHub scanning");
    this.name = "GitHubTokenMissingError";
  }
}

/** github.com's REST API root. GitHub Enterprise Server sets GITHUB_API_URL. */
export const DEFAULT_GITHUB_API_URL = "https://api.github.com";

/**
 * Resolve and validate the GitHub REST API root from GITHUB_API_URL.
 *
 * Every request carries the operator's PAT as a Bearer header, so a malformed
 * or plain-http value would leak it in cleartext or to an unintended host.
 * Require an absolute https URL (GITHUB_ALLOW_INSECURE=1 opts out, for local
 * mocks only) with no credentials, query or fragment, and rebuild it from
 * the parsed origin + path (trailing slashes stripped) so `${baseUrl}${path}`
 * stays well-formed for path-prefixed GHES roots like `/api/v3`. Error
 * messages never echo the raw value, which could carry pasted credentials.
 */
export function resolveGitHubApiUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_GITHUB_API_URL;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      "GITHUB_API_URL is not a valid URL (expected e.g. https://github.example.com/api/v3)",
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      `GITHUB_API_URL must use http(s); got scheme '${parsed.protocol}'`,
    );
  }
  if (parsed.protocol !== "https:" && process.env.GITHUB_ALLOW_INSECURE !== "1") {
    throw new Error(
      "GITHUB_API_URL must use https (the GitHub token is sent as a Bearer header on every request and would otherwise travel in cleartext). Set GITHUB_ALLOW_INSECURE=1 to override for local testing.",
    );
  }
  if (parsed.username || parsed.password) {
    throw new Error(
      "GITHUB_API_URL must not include credentials (user:password@); the GitHub token is supplied separately",
    );
  }
  // `new URL("https://h/api/v3?")` has an empty .search, so also check the
  // raw string for a bare `?`/`#`.
  if (parsed.search || parsed.hash || /[?#]/.test(value)) {
    throw new Error(
      "GITHUB_API_URL must not include a query string or fragment",
    );
  }
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
}

class GitHubClientInstance {
  private token: string;
  private baseUrl: string;

  constructor() {
    const token = process.env.GITHUB_PAT;
    if (!token) {
      throw new GitHubTokenMissingError();
    }
    this.token = token;
    this.baseUrl = resolveGitHubApiUrl(process.env.GITHUB_API_URL);
  }

  // Safety valve for both pagination styles: 100 pages × 100 items is far
  // beyond any sane compliance scan; past that we are almost certainly
  // looping (server bug, non-advancing cursor) or scanning the wrong org.
  private static readonly MAX_PAGES = 100;

  private async requestWithHeaders<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<{ data: T; headers: Headers }> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new GitHubApiError(response.status, path, body);
    }

    const text = await response.text();
    const data = text ? (JSON.parse(text) as T) : (undefined as unknown as T);
    return { data, headers: response.headers };
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const { data } = await this.requestWithHeaders<T>(path, options);
    return data;
  }

  private async fetchAllPages<T>(
    path: string,
    params: Record<string, string> = {},
  ): Promise<T[]> {
    const all: T[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      if (page > GitHubClientInstance.MAX_PAGES) {
        throw new Error(
          `GitHub pagination exceeded ${GitHubClientInstance.MAX_PAGES} pages on ${path}; narrow the query instead of scanning everything`,
        );
      }
      const query = new URLSearchParams({
        ...params,
        page: String(page),
        per_page: String(perPage),
      });
      const result = await this.request<T[]>(`${path}?${query}`);
      all.push(...result);
      if (result.length < perPage) break;
      page++;
    }

    return all;
  }

  /** Extract the rel="next" URL from a GitHub `Link` response header. */
  private parseLinkNext(linkHeader: string | null): string | null {
    if (!linkHeader) return null;
    for (const part of linkHeader.split(",")) {
      const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
      if (match) return match[1];
    }
    return null;
  }

  /**
   * Fetch all pages of a cursor-paginated endpoint (e.g. Dependabot
   * alerts), which uses `per_page` + an opaque `after` cursor advertised
   * via the `Link` response header — NOT `page` numbers. Sending `page`
   * to these endpoints silently returns the first page over and over.
   */
  private async fetchAllCursorPages<T>(
    path: string,
    params: Record<string, string> = {},
  ): Promise<T[]> {
    const all: T[] = [];
    const perPage = 100;
    let after: string | null = null;

    for (let page = 1; ; page++) {
      if (page > GitHubClientInstance.MAX_PAGES) {
        throw new Error(
          `GitHub pagination exceeded ${GitHubClientInstance.MAX_PAGES} pages on ${path}; narrow the query instead of scanning everything`,
        );
      }
      const query = new URLSearchParams({
        ...params,
        per_page: String(perPage),
      });
      if (after) query.set("after", after);
      const { data, headers } = await this.requestWithHeaders<T[]>(
        `${path}?${query}`,
      );
      all.push(...data);

      const next = this.parseLinkNext(headers.get("link"));
      if (!next) break;
      const nextAfter = new URL(next).searchParams.get("after");
      // Stop on missing or non-advancing cursor (server bug guard).
      if (!nextAfter || nextAfter === after) break;
      after = nextAfter;
    }

    return all;
  }

  // === Repos ===
  async listOrgRepos(org: string): Promise<GitHubRepo[]> {
    return this.fetchAllPages<GitHubRepo>(`/orgs/${seg("org", org)}/repos`, {
      type: "all",
      sort: "full_name",
    });
  }

  async listUserRepos(): Promise<GitHubRepo[]> {
    return this.fetchAllPages<GitHubRepo>("/user/repos", {
      sort: "full_name",
      affiliation: "owner,collaborator,organization_member",
    });
  }

  async getRepo(owner: string, repo: string): Promise<GitHubRepo> {
    return this.request<GitHubRepo>(`/repos/${seg("owner", owner)}/${seg("repo", repo)}`);
  }

  // === Branch protection ===
  async getBranchProtection(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<GitHubBranchProtection> {
    // Branch names may legitimately contain slashes (e.g. "release/1.0"), so
    // encodeURIComponent them rather than reject the slash — but still bar
    // path-traversal/control sequences via the leading checks.
    return this.request<GitHubBranchProtection>(
      `/repos/${seg("owner", owner)}/${seg("repo", repo)}/branches/${encodeBranch(branch)}/protection`,
    );
  }

  // === Dependabot / vulnerability alerts ===
  async getDependabotAlerts(
    owner: string,
    repo: string,
    state: string = "open",
  ): Promise<GitHubAlert[]> {
    return this.fetchAllCursorPages<GitHubAlert>(
      `/repos/${seg("owner", owner)}/${seg("repo", repo)}/dependabot/alerts`,
      { state },
    );
  }

  // === Collaborators ===
  async listCollaborators(
    owner: string,
    repo: string,
  ): Promise<GitHubCollaborator[]> {
    return this.fetchAllPages<GitHubCollaborator>(
      `/repos/${seg("owner", owner)}/${seg("repo", repo)}/collaborators`,
    );
  }
}

// Singleton
let instance: GitHubClientInstance | null = null;

export function getGitHubClient(): GitHubClientInstance {
  if (!instance) {
    instance = new GitHubClientInstance();
  }
  return instance;
}
