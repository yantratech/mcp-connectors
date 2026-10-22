/**
 * Unit tests for auth: JWT client assertion, token store perms, refresh, and
 * the single-flight guard. `fetch` is stubbed so no network is touched.
 *
 * Run: node --test test/auth.test.mjs
 */
import { afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import jwt from "jsonwebtoken";

import {
  _resetTokenCacheForTests,
  buildClientAssertion,
  exchangeAuthorizationCode,
  forceRefreshAccessToken,
  getAccessToken,
  readTokenStore,
  writeTokenStore,
} from "../dist/auth.js";

let publicKey;
let baseConfig;
let realFetch;

before(() => {
  const { privateKey, publicKey: pub } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  publicKey = pub;
  const dir = mkdtempSync(path.join(tmpdir(), "revolut-auth-"));
  baseConfig = {
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
});

beforeEach(() => {
  realFetch = globalThis.fetch;
  _resetTokenCacheForTests();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function freshConfig() {
  const dir = mkdtempSync(path.join(tmpdir(), "revolut-auth-case-"));
  return { ...baseConfig, tokenStorePath: path.join(dir, "tokens-sandbox.json") };
}

describe("buildClientAssertion", () => {
  it("signs an RS256 JWT with the documented claims and a numeric exp", () => {
    const token = buildClientAssertion(baseConfig);
    const decoded = jwt.verify(token, publicKey, { algorithms: ["RS256"] });
    assert.equal(decoded.iss, "example.com");
    assert.equal(decoded.sub, "test-client-id");
    assert.equal(decoded.aud, "https://revolut.com");
    assert.equal(typeof decoded.exp, "number");
    const now = Math.floor(Date.now() / 1000);
    assert.ok(decoded.exp > now + 280 && decoded.exp <= now + 320, "exp ~5 min out");
  });
});

describe("token store", () => {
  it("writes the store with mode 0600 and round-trips", () => {
    const cfg = freshConfig();
    writeTokenStore(cfg, {
      refresh_token: "oa_sand_R",
      access_token: "oa_sand_A",
      access_token_expires_at: 123,
    });
    const mode = statSync(cfg.tokenStorePath).mode & 0o777;
    assert.equal(mode, 0o600, `expected 0600, got 0${mode.toString(8)}`);
    const read = readTokenStore(cfg);
    assert.equal(read.refresh_token, "oa_sand_R");
    assert.equal(read.access_token, "oa_sand_A");
  });

  it("throws an actionable error when the store is missing", () => {
    const cfg = { ...baseConfig, tokenStorePath: "/nonexistent/tokens.json" };
    assert.throws(() => readTokenStore(cfg), /npx -y -p @yantratech\/revolut-mcp-server revolut-mcp-authorize <code>/);
  });
});

describe("refresh", () => {
  it("preserves the refresh_token (refresh grant returns none) and updates the access token", async () => {
    const cfg = freshConfig();
    writeTokenStore(cfg, {
      refresh_token: "oa_sand_KEEPME",
      access_token: "oa_sand_OLD",
      access_token_expires_at: Date.now() - 1000, // expired -> forces refresh
    });
    _resetTokenCacheForTests();

    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () =>
          JSON.stringify({
            access_token: "oa_sand_NEW",
            token_type: "bearer",
            expires_in: 2399,
          }),
      };
    };

    const token = await getAccessToken(cfg);
    assert.equal(token, "oa_sand_NEW");
    assert.equal(calls, 1);
    const stored = readTokenStore(cfg);
    assert.equal(stored.refresh_token, "oa_sand_KEEPME");
    assert.equal(stored.access_token, "oa_sand_NEW");
    assert.ok(stored.access_token_expires_at > Date.now());
  });

  it("coalesces concurrent refreshes into a single token call (single-flight)", async () => {
    const cfg = freshConfig();
    writeTokenStore(cfg, {
      refresh_token: "oa_sand_R",
      access_token: "oa_sand_OLD",
      access_token_expires_at: Date.now() - 1000,
    });
    _resetTokenCacheForTests();

    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () =>
          JSON.stringify({ access_token: "oa_sand_NEW", token_type: "bearer", expires_in: 2399 }),
      };
    };

    const [a, b] = await Promise.all([
      getAccessToken(cfg),
      forceRefreshAccessToken(cfg),
    ]);
    assert.equal(a, "oa_sand_NEW");
    assert.equal(b, "oa_sand_NEW");
    assert.equal(calls, 1, "concurrent refreshes must share one token call");
  });

  it("surfaces an actionable error when the token endpoint rejects the refresh", async () => {
    const cfg = freshConfig();
    writeTokenStore(cfg, {
      refresh_token: "oa_sand_BAD",
      access_token: "",
      access_token_expires_at: 0,
    });
    _resetTokenCacheForTests();
    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      headers: new Map(),
      text: async () =>
        JSON.stringify({ error: "invalid_grant", error_description: "revoked" }),
    });
    await assert.rejects(() => getAccessToken(cfg), /consent|authorize|revoked/i);
  });
});

describe("exchangeAuthorizationCode", () => {
  it("persists tokens from the authorization-code grant", async () => {
    const cfg = freshConfig();
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () =>
        JSON.stringify({
          access_token: "oa_sand_A",
          token_type: "bearer",
          expires_in: 2399,
          refresh_token: "oa_sand_R",
        }),
    });
    const tokens = await exchangeAuthorizationCode(cfg, "the-code");
    assert.equal(tokens.refresh_token, "oa_sand_R");
    assert.equal(readTokenStore(cfg).access_token, "oa_sand_A");
  });

  it("rejects when no refresh_token comes back (e.g. an expired code)", async () => {
    const cfg = freshConfig();
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () =>
        JSON.stringify({ access_token: "oa_sand_A", token_type: "bearer", expires_in: 2399 }),
    });
    await assert.rejects(() => exchangeAuthorizationCode(cfg, "expired"), /refresh_token/);
  });
});
