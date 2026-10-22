/**
 * Offline tests: the Drata and GitHub clients throw typed errors
 * (DrataApiError / GitHubApiError / GitHubTokenMissingError) carrying the
 * HTTP status, and the 429 retry, 402 error mapping, and GitHub setup-hint
 * paths branch on those fields instead of string-matching messages.
 *
 * Run: node --test test/typed-errors.test.js   (requires `npm run build`)
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

let server;
let lastStatus = 500;
let lastBody = "";
/** Responses served (in order) before falling back to lastStatus/lastBody. */
let queued = [];
let requestCount = 0;

before(async () => {
  server = http.createServer((req, res) => {
    requestCount++;
    const next = queued.shift() ?? { status: lastStatus, body: lastBody };
    res.writeHead(next.status, { "content-type": "application/json" });
    res.end(next.body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.DRATA_API_KEY = "dummy";
  process.env.DRATA_BASE_URL = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

describe("DrataApiError", () => {
  it("is thrown for V1 and V2 non-2xx responses with status, path and body", async () => {
    const { getDrataClient, DrataApiError } = await import(
      "../dist/clients/drata-client.js"
    );
    lastStatus = 404;
    lastBody = '{"message":"nope"}';
    for (const call of [
      () => getDrataClient().getJson("/public/controls/1"),
      () => getDrataClient().getV2("/public/v2/workspaces"),
    ]) {
      const err = await call().then(
        () => assert.fail("expected a rejection"),
        (e) => e,
      );
      assert.ok(err instanceof DrataApiError, `got ${err?.name}`);
      assert.ok(err instanceof Error);
      assert.equal(err.status, 404);
      assert.match(err.path, /^\/public\//);
      assert.equal(err.body, '{"message":"nope"}');
      // Message format is unchanged for logs and model-facing text.
      assert.match(err.message, /Drata( V2)? API error 404 on \/public\//);
    }
  });
});

describe("retryOnceOn429", () => {
  it("retries exactly once on a DrataApiError with status 429", async () => {
    const { DrataApiError } = await import("../dist/clients/drata-client.js");
    const { retryOnceOn429 } = await import("../dist/handlers/v2-write.handler.js");
    let calls = 0;
    const result = await retryOnceOn429(async () => {
      calls++;
      if (calls === 1) throw new DrataApiError("rate limited", 429, "/x", "");
      return "ok";
    }, 0);
    assert.equal(result, "ok");
    assert.equal(calls, 2);
  });

  it("retries a real 429 from the client once, then returns the data", async () => {
    const { getDrataClient } = await import("../dist/clients/drata-client.js");
    const { retryOnceOn429 } = await import("../dist/handlers/v2-write.handler.js");
    queued = [
      { status: 429, body: '{"message":"Too Many Requests"}' },
      { status: 200, body: '{"data":[{"id":1}],"pagination":{"cursor":null}}' },
    ];
    requestCount = 0;
    const rows = await retryOnceOn429(
      () => getDrataClient().fetchAllV2("/public/v2/vendors/1/security-reviews"),
      0,
    );
    assert.deepEqual(rows, [{ id: 1 }]);
    assert.equal(requestCount, 2);
    queued = [];
  });

  it("does not retry other statuses", async () => {
    const { DrataApiError } = await import("../dist/clients/drata-client.js");
    const { retryOnceOn429 } = await import("../dist/handlers/v2-write.handler.js");
    let calls = 0;
    await assert.rejects(
      retryOnceOn429(async () => {
        calls++;
        throw new DrataApiError("Drata V2 API error 500 on /x: boom", 500, "/x", "boom");
      }, 0),
      (e) => e.status === 500,
    );
    assert.equal(calls, 1);
  });

  it("matches on the typed status, not on the message text", async () => {
    const { retryOnceOn429 } = await import("../dist/handlers/v2-write.handler.js");
    let calls = 0;
    // A plain Error whose text merely mentions 429 is not a rate limit.
    await assert.rejects(
      retryOnceOn429(async () => {
        calls++;
        throw new Error("Drata V2 API error 429 on /x: looks like one");
      }, 0),
    );
    assert.equal(calls, 1);
  });
});

describe("mapDrataError", () => {
  it("uses the typed status/path/body when the message format differs", async () => {
    const { DrataApiError } = await import("../dist/clients/drata-client.js");
    const { mapDrataError } = await import("../dist/helpers/error-mapping.js");
    const mapped = mapDrataError(
      new DrataApiError(
        "unrecognisable message",
        402,
        "/public/v2/risk-registers",
        '{"statusCode":402,"message":"You must upgrade your plan","code":10740}',
      ),
    );
    assert.equal(mapped.httpStatus, 402);
    assert.equal(mapped.retryable, false);
    assert.equal(mapped.drataCode, 10740);
    assert.ok(mapped.feature, "expected the gated feature to be attributed from the typed path");
    assert.match(mapped.error, /You must upgrade your plan/);
  });

  it("still parses plain Error messages (fallback)", async () => {
    const { mapDrataError } = await import("../dist/helpers/error-mapping.js");
    const mapped = mapDrataError(
      new Error('Drata V2 API error 403 on /public/v2/x: {"message":17003,"code":10000}'),
    );
    assert.equal(mapped.httpStatus, 403);
    assert.equal(mapped.drataMessageCode, 17003);
  });
});

describe("GitHub typed errors", () => {
  it("GitHubApiError carries status/path/body with the historical message", async () => {
    const { GitHubApiError } = await import("../dist/clients/github-client.js");
    const err = new GitHubApiError(404, "/repos/a/b", '{"message":"Not Found"}');
    assert.equal(err.status, 404);
    assert.equal(err.path, "/repos/a/b");
    assert.equal(err.body, '{"message":"Not Found"}');
    assert.equal(err.message, 'GitHub API error 404 on /repos/a/b: {"message":"Not Found"}');
  });

  it("a missing GITHUB_PAT surfaces the setup hint via GitHubTokenMissingError", async () => {
    // Run in a child so the lazily-built GitHub client singleton sees no PAT.
    const { spawnSync } = await import("node:child_process");
    const script = `
      const c = await import(${JSON.stringify(new URL("../dist/clients/github-client.js", import.meta.url).href)});
      const h = await import(${JSON.stringify(new URL("../dist/handlers/github-scan.handler.js", import.meta.url).href)});
      let typed = false;
      try { c.getGitHubClient(); } catch (e) { typed = e instanceof c.GitHubTokenMissingError; }
      const res = await h.scanGitHubRepos("acme");
      process.stdout.write(JSON.stringify({ typed, res }));
    `;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { PATH: process.env.PATH ?? "", DRATA_API_KEY: "dummy" },
      encoding: "utf8",
    });
    assert.equal(child.status, 0, child.stderr);
    const { typed, res } = JSON.parse(child.stdout);
    assert.equal(typed, true);
    assert.equal(res.isError, true);
    assert.match(res.error, /Personal Access Token/);
  });
});
