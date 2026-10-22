/**
 * Offline tests for the four scan_github_* tools.
 *
 * Stands up a local node:http server that mimics the GitHub REST API (same
 * pattern as the e2e suite's Drata mock) and drives the compiled handlers in
 * dist/handlers/github-scan.handler.js against it.
 *
 * The client is pointed at the mock through GITHUB_API_URL, mounted under a
 * GitHub Enterprise Server-style `/api/v3` prefix so path-prefixed roots are
 * exercised too. A block-only fetch guard rejects any other destination
 * (including api.github.com), which guarantees the suite can never touch the
 * network and fails loudly if the client ever ignores GITHUB_API_URL.
 *
 * Run: node --test test/github-scan.test.js
 */
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

/** GHES-style REST prefix the mock is mounted under. */
const API_PREFIX = "/api/v3";

// The client constructor requires GITHUB_PAT; set it before dist is imported.
process.env.GITHUB_PAT = "dummy-pat";
process.env.DRATA_API_KEY = "dummy";

// ── Mock data ──────────────────────────────────────────────────

/** 103 org repos — forces the repo scan across two pages (100 + 3). */
const ORG_REPOS = Array.from({ length: 103 }, (_, i) => ({
  id: i + 1,
  name: `repo-${i + 1}`,
  full_name: `acme/repo-${i + 1}`,
  private: i % 2 === 0,
  html_url: `https://github.com/acme/repo-${i + 1}`,
  description: null,
  default_branch: "main",
  visibility: i % 2 === 0 ? "private" : "public",
  archived: i === 102,
  has_issues: true,
  has_wiki: false,
}));

const USER_REPOS = [
  {
    id: 900,
    name: "dotfiles",
    full_name: "example-user/dotfiles",
    private: true,
    html_url: "https://github.com/example-user/dotfiles",
    description: "personal config",
    default_branch: "main",
    visibility: "private",
    archived: false,
    has_issues: true,
    has_wiki: false,
  },
  {
    id: 901,
    name: "sandbox",
    full_name: "example-user/sandbox",
    private: false,
    html_url: "https://github.com/example-user/sandbox",
    description: null,
    default_branch: "master",
    visibility: "public",
    archived: false,
    has_issues: false,
    has_wiki: false,
  },
];

/** Full branch protection payload, as GitHub returns for a protected branch. */
const PROTECTION = {
  required_status_checks: { strict: true, contexts: ["ci/build"] },
  enforce_admins: { enabled: true },
  required_pull_request_reviews: {
    dismiss_stale_reviews: true,
    require_code_owner_reviews: false,
    required_approving_review_count: 2,
  },
  restrictions: null,
  required_signatures: { enabled: false },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false },
};

/**
 * Dependabot alerts split across two cursor pages. GitHub paginates this
 * endpoint with Link headers carrying an `after` cursor — the mock mirrors
 * that: the first page advertises rel="next" with after=cursor-2, the second
 * page has no Link header.
 */
const ALERTS_PAGE_1 = [
  {
    number: 1,
    state: "open",
    dependency: {
      package: { ecosystem: "npm", name: "lodash" },
      manifest_path: "package-lock.json",
    },
    security_advisory: {
      severity: "critical",
      summary: "Prototype pollution in lodash",
      cve_id: "CVE-2026-0001",
    },
    created_at: "2026-01-10T00:00:00Z",
    fixed_at: null,
  },
  {
    number: 2,
    state: "open",
    dependency: {
      package: { ecosystem: "pip", name: "requests" },
      manifest_path: "requirements.txt",
    },
    security_advisory: {
      severity: "high",
      summary: "Cert bypass in requests",
      cve_id: "CVE-2026-0002",
    },
    created_at: "2026-02-15T00:00:00Z",
    fixed_at: null,
  },
];

const ALERTS_PAGE_2 = [
  {
    number: 3,
    state: "open",
    dependency: {
      package: { ecosystem: "npm", name: "minimist" },
      manifest_path: "package-lock.json",
    },
    security_advisory: {
      severity: "low",
      summary: "Argument injection in minimist",
      cve_id: null,
    },
    created_at: "2026-03-01T00:00:00Z",
    fixed_at: null,
  },
];

const COLLABORATORS = [
  {
    login: "sally",
    id: 1,
    html_url: "https://github.com/sally",
    role_name: "admin",
    permissions: { admin: true, push: true, pull: true },
  },
  {
    login: "pat",
    id: 2,
    html_url: "https://github.com/pat",
    role_name: "read",
    permissions: { admin: false, push: false, pull: true },
  },
];

// ── Mock GitHub API server ─────────────────────────────────────

/** @type {Array<{method: string, rawPath: string, path: string, query: URLSearchParams, headers: http.IncomingHttpHeaders}>} */
let capturedRequests = [];

function json(res, status, data, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(data));
}

function createMockGitHub() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    // Requests outside the configured API root are a client bug: 404 them
    // without stripping so assertions on `path` see the raw wire path.
    const path = url.pathname.startsWith(`${API_PREFIX}/`)
      ? url.pathname.slice(API_PREFIX.length)
      : url.pathname;
    capturedRequests.push({
      method: req.method,
      rawPath: url.pathname,
      path,
      query: url.searchParams,
      headers: req.headers,
    });

    // All client calls must authenticate with the PAT.
    if (req.headers["authorization"] !== "Bearer dummy-pat") {
      return json(res, 401, { message: "Bad credentials" });
    }

    // Org repos — classic page-number pagination with a rel="next" Link.
    if (req.method === "GET" && path === "/orgs/acme/repos") {
      const page = Number(url.searchParams.get("page") ?? 1);
      const perPage = Number(url.searchParams.get("per_page") ?? 30);
      const start = (page - 1) * perPage;
      const slice = ORG_REPOS.slice(start, start + perPage);
      const headers = {};
      if (start + perPage < ORG_REPOS.length) {
        const next = new URL(`${apiUrl}/orgs/acme/repos`);
        for (const [k, v] of url.searchParams) next.searchParams.set(k, v);
        next.searchParams.set("page", String(page + 1));
        headers["Link"] = `<${next}>; rel="next"`;
      }
      return json(res, 200, slice, headers);
    }

    if (req.method === "GET" && path === "/user/repos") {
      return json(res, 200, USER_REPOS);
    }

    // Repo metadata — used by scanBranchProtection to resolve the
    // default branch when no branch param is given.
    if (
      req.method === "GET" &&
      (path === "/repos/acme/secure-repo" || path === "/repos/acme/open-repo")
    ) {
      const name = path.split("/").pop();
      return json(res, 200, {
        id: 1000,
        name,
        full_name: `acme/${name}`,
        private: true,
        html_url: `https://github.com/acme/${name}`,
        description: null,
        default_branch: "main",
        visibility: "private",
        archived: false,
        has_issues: true,
        has_wiki: false,
      });
    }

    // Branch protection — protected branch returns the full payload …
    if (
      req.method === "GET" &&
      path === "/repos/acme/secure-repo/branches/main/protection"
    ) {
      return json(res, 200, PROTECTION);
    }
    // … and an unprotected branch is a 404 with GitHub's standard body.
    if (
      req.method === "GET" &&
      path === "/repos/acme/open-repo/branches/main/protection"
    ) {
      return json(res, 404, {
        message: "Branch not protected",
        documentation_url:
          "https://docs.github.com/rest/branches/branch-protection",
      });
    }

    // Dependabot alerts — Link-header cursor pagination (`after` param).
    if (
      req.method === "GET" &&
      path === "/repos/acme/web-app/dependabot/alerts"
    ) {
      if (url.searchParams.get("state") === "fixed") {
        return json(res, 200, []);
      }
      const after = url.searchParams.get("after");
      if (!after) {
        const next = new URL(`${apiUrl}${path}`);
        for (const [k, v] of url.searchParams) next.searchParams.set(k, v);
        next.searchParams.set("after", "cursor-2");
        return json(res, 200, ALERTS_PAGE_1, {
          Link: `<${next}>; rel="next"`,
        });
      }
      if (after === "cursor-2") {
        return json(res, 200, ALERTS_PAGE_2);
      }
      return json(res, 200, []);
    }

    // Collaborators.
    if (req.method === "GET" && path === "/repos/acme/web-app/collaborators") {
      return json(res, 200, COLLABORATORS);
    }

    // Anything not under the API root never matches a route above.
    if (!url.pathname.startsWith(`${API_PREFIX}/`)) {
      return json(res, 404, { message: `outside ${API_PREFIX}: ${url.pathname}` });
    }

    // Catch-all: behave like GitHub for unknown resources.
    return json(res, 404, {
      message: "Not Found",
      documentation_url: "https://docs.github.com/rest",
    });
  });
}

// ── Test wiring ────────────────────────────────────────────────

let server;
let mockOrigin;
let apiUrl;
let handlers;
const realFetch = globalThis.fetch;

before(async () => {
  server = createMockGitHub();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  mockOrigin = `http://127.0.0.1:${server.address().port}`;
  apiUrl = `${mockOrigin}${API_PREFIX}`;

  // Point the client at the mock (trailing slash exercises normalisation).
  // The mock is plain http on loopback, so opt out of the https-only guard.
  process.env.GITHUB_API_URL = `${apiUrl}/`;
  process.env.GITHUB_ALLOW_INSECURE = "1";

  // Block-only guard: no rewriting, so a client that ignored GITHUB_API_URL
  // and called api.github.com would fail here instead of being rescued.
  globalThis.fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.startsWith(`${mockOrigin}/`)) {
      return realFetch(url, init);
    }
    return Promise.reject(
      new Error(`Blocked non-mock URL in offline test: ${url}`),
    );
  };

  handlers = await import("../dist/handlers/github-scan.handler.js");
});

after(() => {
  globalThis.fetch = realFetch;
  server?.close();
});

beforeEach(() => {
  capturedRequests = [];
});

// ── scan_github_repos ──────────────────────────────────────────

describe("scan_github_repos", () => {
  it("paginates org repos across pages and maps fields", async () => {
    const res = await handlers.scanGitHubRepos("acme");
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.count, 103);
    assert.equal(res.result.repos.length, 103);

    const first = res.result.repos[0];
    assert.deepEqual(first, {
      name: "acme/repo-1",
      private: true,
      visibility: "private",
      defaultBranch: "main",
      archived: false,
      url: "https://github.com/acme/repo-1",
    });
    assert.equal(res.result.repos[102].archived, true);

    // 103 repos at 100/page requires at least two requests.
    const repoCalls = capturedRequests.filter(
      (r) => r.path === "/orgs/acme/repos",
    );
    assert.ok(
      repoCalls.length >= 2,
      `expected pagination to issue >= 2 requests, saw ${repoCalls.length}`,
    );
  });

  it("falls back to the authenticated user's repos when org is omitted", async () => {
    const res = await handlers.scanGitHubRepos();
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.count, 2);
    assert.deepEqual(
      res.result.repos.map((r) => r.name),
      ["example-user/dotfiles", "example-user/sandbox"],
    );
    assert.ok(capturedRequests.some((r) => r.path === "/user/repos"));
  });

  it("sends the PAT and GitHub media-type headers", async () => {
    await handlers.scanGitHubRepos("acme");
    const call = capturedRequests.find((r) => r.path === "/orgs/acme/repos");
    assert.equal(call.headers["authorization"], "Bearer dummy-pat");
    assert.equal(call.headers["accept"], "application/vnd.github+json");
    assert.equal(call.headers["x-github-api-version"], "2022-11-28");
  });

  it("surfaces API failures as isError with status and path", async () => {
    const res = await handlers.scanGitHubRepos("no-such-org");
    assert.equal(res.isError, true);
    assert.match(res.error, /404/);
    assert.match(res.error, /no-such-org/);
  });
});

// ── scan_github_branch_protection ──────────────────────────────

describe("scan_github_branch_protection", () => {
  it("reports protection settings for a protected branch", async () => {
    const res = await handlers.scanBranchProtection(
      "acme",
      "secure-repo",
      "main",
    );
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.repo, "acme/secure-repo");
    assert.equal(res.result.branch, "main");
    assert.equal(res.result.requiresStatusChecks, true);
    assert.equal(res.result.enforceAdmins, true);
    assert.equal(res.result.requiresPullRequestReviews, true);
    assert.equal(res.result.requiredApprovers, 2);
    assert.equal(res.result.dismissesStaleReviews, true);
    assert.equal(res.result.requiresCodeOwnerReviews, false);
    assert.equal(res.result.allowForcePushes, false);
    assert.equal(res.result.allowDeletions, false);
    assert.equal(res.result.protected, true);
  });

  it("treats an unprotected branch (404) as a structured protected:false result, not an error", async () => {
    // `branch` omitted on purpose — the handler must resolve the repo's
    // default branch from the /repos/:owner/:repo metadata endpoint.
    const res = await handlers.scanBranchProtection("acme", "open-repo");
    assert.equal(
      res.isError,
      false,
      "an unprotected branch is a finding, not a failure — expected " +
        `isError:false with { protected: false }, got error: ${res.error}`,
    );
    assert.equal(res.result.protected, false);
    assert.equal(res.result.repo, "acme/open-repo");
    assert.equal(res.result.branch, "main");
  });

  it("keeps any other 404 on the protection endpoint an error", async () => {
    // The mock serves no protection for this branch, so GitHub's generic
    // "Not Found" 404 comes back. Only the "Branch not protected" body is a
    // finding; a missing branch/repo or no access must not read as unprotected.
    const res = await handlers.scanBranchProtection(
      "acme",
      "secure-repo",
      "no-such-branch",
    );
    assert.equal(res.isError, true);
    assert.match(res.error, /GitHub API error 404/);
  });
});

// ── scan_github_vulnerabilities ────────────────────────────────

describe("scan_github_vulnerabilities", () => {
  it("follows Link-header cursor pagination and aggregates by severity", async () => {
    const res = await handlers.scanVulnerabilities("acme", "web-app");
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.repo, "acme/web-app");
    assert.equal(res.result.state, "open");
    assert.equal(res.result.totalAlerts, 3);
    assert.deepEqual(res.result.bySeverity, { critical: 1, high: 1, low: 1 });

    // The second page is only reachable via the rel="next" cursor — assert
    // the client actually presented it.
    const alertCalls = capturedRequests.filter(
      (r) => r.path === "/repos/acme/web-app/dependabot/alerts",
    );
    assert.ok(alertCalls.length >= 2, "expected a follow-up cursor request");
    assert.ok(
      alertCalls.some((r) => r.query.get("after") === "cursor-2"),
      "expected the client to follow the Link header's after=cursor-2",
    );
  });

  it("maps alert fields into the compact shape", async () => {
    const res = await handlers.scanVulnerabilities("acme", "web-app");
    assert.equal(res.isError, false, res.error);
    const lodash = res.result.alerts.find((a) => a.number === 1);
    assert.deepEqual(lodash, {
      number: 1,
      state: "open",
      severity: "critical",
      summary: "Prototype pollution in lodash",
      cve: "CVE-2026-0001",
      package: "lodash",
      ecosystem: "npm",
      manifest: "package-lock.json",
      createdAt: "2026-01-10T00:00:00Z",
      fixedAt: null,
    });
  });

  it("forwards the state filter to the API", async () => {
    const res = await handlers.scanVulnerabilities("acme", "web-app", "fixed");
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.state, "fixed");
    assert.equal(res.result.totalAlerts, 0);
    const call = capturedRequests.find(
      (r) => r.path === "/repos/acme/web-app/dependabot/alerts",
    );
    assert.equal(call.query.get("state"), "fixed");
  });
});

// ── scan_github_collaborators ──────────────────────────────────

describe("scan_github_collaborators", () => {
  it("lists collaborators with role and permissions", async () => {
    const res = await handlers.scanCollaborators("acme", "web-app");
    assert.equal(res.isError, false, res.error);
    assert.equal(res.result.repo, "acme/web-app");
    assert.equal(res.result.count, 2);
    assert.deepEqual(res.result.collaborators[0], {
      login: "sally",
      role: "admin",
      permissions: { admin: true, push: true, pull: true },
      url: "https://github.com/sally",
    });
    assert.deepEqual(res.result.collaborators[1].permissions, {
      admin: false,
      push: false,
      pull: true,
    });
  });

  it("surfaces an unknown repo as isError", async () => {
    const res = await handlers.scanCollaborators("acme", "ghost");
    assert.equal(res.isError, true);
    assert.match(res.error, /404/);
  });
});

// ── Path-segment injection guard (security) ────────────────────
//
// owner/org/repo/branch arrive as free-form strings and are interpolated into
// the GitHub API path under the operator's PAT. A crafted value containing
// extra path segments, query/fragment delimiters, `..`, or `%` must NOT be
// able to redirect the request to a different endpoint than the tool
// advertises. The client validates each segment and rejects (or encodes) such
// values; assert that and that no malicious request ever reaches the mock.

describe("path-segment injection guard", () => {
  /** Values that try to escape the intended endpoint surface. */
  const MALICIOUS_OWNER = [
    "someorg/repos/PRIVATE-REPO/contents/.env",
    "acme?ref=secret",
    "acme#frag",
    "..",
    "../../etc",
    "acme%2f..%2fsecrets",
    "acme repo",
  ];

  for (const bad of MALICIOUS_OWNER) {
    it(`rejects owner "${bad}" without issuing the request`, async () => {
      const res = await handlers.scanCollaborators(bad, "web-app");
      assert.equal(res.isError, true, "expected the crafted owner to be rejected");
      assert.match(res.error, /illegal characters/i);
      // The guard must short-circuit before any HTTP call — nothing reaches
      // the mock GitHub server.
      assert.equal(
        capturedRequests.length,
        0,
        `expected no request to be issued for crafted owner, saw ${capturedRequests
          .map((r) => r.path)
          .join(", ")}`,
      );
    });
  }

  it("rejects a repo value carrying extra path segments", async () => {
    const res = await handlers.scanCollaborators(
      "acme",
      "web-app/contents/.github/workflows",
    );
    assert.equal(res.isError, true);
    assert.match(res.error, /illegal characters/i);
    assert.equal(capturedRequests.length, 0);
  });

  it("rejects a branch value carrying a traversal sequence", async () => {
    const res = await handlers.scanBranchProtection(
      "acme",
      "secure-repo",
      "..%2f..%2fprotection",
    );
    assert.equal(res.isError, true);
    // `%` is rejected by the segment guard before the branch encoder runs.
    assert.match(res.error, /illegal characters/i);
    assert.equal(capturedRequests.length, 0);
  });

  it("still accepts a legitimate slashed branch name (encoded, not rejected)", async () => {
    // A real ref like "release/1.0" must keep working: the client encodes the
    // slash so the request stays on the advertised protection endpoint.
    const res = await handlers.scanBranchProtection(
      "acme",
      "secure-repo",
      "release/1.0",
    );
    // The mock only serves .../branches/main/protection, so this 404s — but
    // crucially it issues a request to the *encoded* branch path, proving the
    // legitimate slashed ref was not rejected at the guard.
    const call = capturedRequests.find((r) =>
      r.path.includes("/repos/acme/secure-repo/branches/"),
    );
    assert.ok(call, "expected a branch-protection request to be issued");
    assert.match(call.path, /branches\/release%2F1\.0\/protection/);
    // (The 404 itself is fine; we are asserting routing, not the result.)
    assert.ok(res.isError === true || res.isError === false);
  });
});

// ── GITHUB_API_URL override ────────────────────────────────────

describe("GITHUB_API_URL", () => {
  it("routes every request under the configured API root, including paginated hops", async () => {
    // Org repos (page-number paging) + Dependabot (Link-cursor paging).
    const repos = await handlers.scanGitHubRepos("acme");
    assert.equal(repos.isError, false, repos.error);
    const alerts = await handlers.scanVulnerabilities("acme", "web-app");
    assert.equal(alerts.isError, false, alerts.error);
    assert.ok(capturedRequests.length >= 4, "expected paginated traffic");
    for (const r of capturedRequests) {
      assert.ok(
        r.rawPath.startsWith(`${API_PREFIX}/`),
        `request escaped the API root: ${r.rawPath}`,
      );
    }
  });

  it("surfaces an invalid GITHUB_API_URL as itself, not as a missing-PAT hint", async () => {
    // githubError() shows the token setup hint only for
    // GitHubTokenMissingError; an invalid URL must surface as itself.
    // Exercised in a child process because the client is a lazily-built
    // singleton.
    const { spawnSync } = await import("node:child_process");
    const script = `
      const h = await import(${JSON.stringify(new URL("../dist/handlers/github-scan.handler.js", import.meta.url).href)});
      const res = await h.scanGitHubRepos("acme");
      process.stdout.write(JSON.stringify(res));
    `;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: {
        PATH: process.env.PATH ?? "",
        GITHUB_PAT: "dummy-pat",
        DRATA_API_KEY: "dummy",
        // Unroutable loopback port: even if validation regressed, the child
        // could not reach a real host with the dummy PAT.
        GITHUB_API_URL: "http://127.0.0.1:9/api/v3",
      },
      encoding: "utf8",
    });
    assert.equal(child.status, 0, child.stderr);
    const res = JSON.parse(child.stdout);
    assert.equal(res.isError, true);
    assert.match(res.error, /GITHUB_API_URL must use https/);
    assert.doesNotMatch(res.error, /Personal Access Token/);
  });

  describe("resolveGitHubApiUrl", () => {
    let resolveGitHubApiUrl;
    let DEFAULT_GITHUB_API_URL;
    let savedInsecure;
    before(async () => {
      ({ resolveGitHubApiUrl, DEFAULT_GITHUB_API_URL } = await import(
        "../dist/clients/github-client.js"
      ));
      savedInsecure = process.env.GITHUB_ALLOW_INSECURE;
    });
    beforeEach(() => {
      delete process.env.GITHUB_ALLOW_INSECURE;
    });
    afterEach(() => {
      if (savedInsecure === undefined) delete process.env.GITHUB_ALLOW_INSECURE;
      else process.env.GITHUB_ALLOW_INSECURE = savedInsecure;
    });

    it("defaults to api.github.com when unset or blank", () => {
      assert.equal(DEFAULT_GITHUB_API_URL, "https://api.github.com");
      assert.equal(resolveGitHubApiUrl(undefined), "https://api.github.com");
      assert.equal(resolveGitHubApiUrl("  "), "https://api.github.com");
    });

    it("accepts a GHES root and strips trailing slashes", () => {
      assert.equal(
        resolveGitHubApiUrl("https://github.example.com/api/v3//"),
        "https://github.example.com/api/v3",
      );
    });

    it("rejects embedded credentials without echoing them", () => {
      assert.throws(
        () => resolveGitHubApiUrl("https://user:s3cret@github.example.com/api/v3"),
        (err) => /must not include credentials/.test(err.message) && !err.message.includes("s3cret"),
      );
    });

    it("never mentions GITHUB_PAT in a rejection (githubError would misreport it)", () => {
      for (const bad of [
        "not a url",
        "file:///etc/passwd",
        "http://github.example.com/api/v3",
        "https://user:pw@github.example.com/api/v3",
        "https://github.example.com/api/v3?",
        "https://github.example.com/api/v3#frag",
      ]) {
        assert.throws(
          () => resolveGitHubApiUrl(bad),
          (err) => !/GITHUB_PAT/.test(err.message),
          bad,
        );
      }
    });

    it("rejects plain http unless GITHUB_ALLOW_INSECURE=1", () => {
      assert.throws(
        () => resolveGitHubApiUrl("http://github.example.com/api/v3"),
        /must use https/,
      );
      process.env.GITHUB_ALLOW_INSECURE = "1";
      assert.equal(
        resolveGitHubApiUrl("http://127.0.0.1:8080/api/v3"),
        "http://127.0.0.1:8080/api/v3",
      );
    });

    it("rejects malformed values, non-http schemes, and query strings", () => {
      assert.throws(() => resolveGitHubApiUrl("not a url"), /not a valid URL/);
      // A bare trailing ? or # parses to an empty search/hash — still rejected.
      for (const bad of [
        "https://github.example.com/api/v3?",
        "https://github.example.com/api/v3#",
        "https://github.example.com/api/v3#frag",
      ]) {
        assert.throws(() => resolveGitHubApiUrl(bad), /query string or fragment/, bad);
      }
      assert.throws(
        () => resolveGitHubApiUrl("file:///etc/passwd"),
        /must use http\(s\)/,
      );
      assert.throws(
        () => resolveGitHubApiUrl("https://github.example.com/api/v3?x=1"),
        /query string or fragment/,
      );
    });
  });
});
