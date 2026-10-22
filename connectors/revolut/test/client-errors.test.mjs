/**
 * Wire-level checks for RevolutClient's error contract: a non-2xx answer
 * becomes a RevolutApiError carrying the HTTP status, so create_payment_draft
 * can tell a real 404 from auth, rate-limit and server failures. `fetch` is
 * stubbed; no network.
 */
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _resetTokenCacheForTests, writeTokenStore } from "../dist/auth.js";
import { RevolutApiError, RevolutClient, isNotFound } from "../dist/client.js";

const CP = "11111111-1111-1111-1111-111111111111";
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
  _resetTokenCacheForTests();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function clientWithFreshToken() {
  const dir = mkdtempSync(path.join(tmpdir(), "revolut-client-"));
  const config = {
    env: "sandbox",
    apiBaseUrl: "https://sandbox-b2b.revolut.com/api/1.0",
    webAppUrl: "https://sandbox-business.revolut.com",
    clientId: "test-client-id",
    privateKeyPath: "/dev/null",
    privateKey,
    jwtIss: "example.com",
    operator: "alice",
    tokenStorePath: path.join(dir, "tokens-sandbox.json"),
  };
  writeTokenStore(config, {
    refresh_token: "oa_sand_refresh",
    access_token: "oa_sand_access",
    access_token_expires_at: Date.now() + 3_600_000,
  });
  return new RevolutClient(config);
}

const respond = (status, body = "", headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(headers),
  text: async () => body,
});

describe("RevolutClient error contract", () => {
  for (const status of [400, 403, 404, 500]) {
    it(`a ${status} becomes a RevolutApiError with status ${status}`, async () => {
      const client = clientWithFreshToken();
      globalThis.fetch = async () =>
        respond(status, JSON.stringify({ message: "boom", code: 3006 }));
      await assert.rejects(client.getCounterparty(CP), (e) => {
        assert.ok(e instanceof RevolutApiError);
        assert.equal(e.status, status);
        assert.equal(isNotFound(e), status === 404);
        return true;
      });
    });
  }

  it("a 429 that persists after the one retry carries status 429", async () => {
    const client = clientWithFreshToken();
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return respond(429, "", { "retry-after": "0" });
    };
    await assert.rejects(
      client.getAccount(CP),
      (e) => e instanceof RevolutApiError && e.status === 429,
    );
    assert.equal(calls, 2);
  });

  it("a 401 that persists after a token refresh carries status 401", async () => {
    const client = clientWithFreshToken();
    let tokenCalls = 0;
    const apiAuth = [];
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/auth/token")) {
        tokenCalls += 1;
        return respond(
          200,
          JSON.stringify({
            access_token: "oa_sand_new",
            token_type: "bearer",
            expires_in: 2399,
          }),
        );
      }
      apiAuth.push(init.headers.Authorization);
      return respond(
        401,
        JSON.stringify({ message: "The request should be authorized." }),
      );
    };
    await assert.rejects(
      client.getCounterparty(CP),
      (e) => e instanceof RevolutApiError && e.status === 401 && !isNotFound(e),
    );
    // One refresh, then one retry with the new token.
    assert.equal(tokenCalls, 1);
    assert.deepEqual(apiAuth, ["Bearer oa_sand_access", "Bearer oa_sand_new"]);
  });
});
