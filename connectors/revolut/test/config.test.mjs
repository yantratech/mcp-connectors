/**
 * Unit tests for config loading/validation. Run: node --test test/config.test.mjs
 */
import { afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadConfig } from "../dist/config.js";

const REVOLUT_VARS = [
  "REVOLUT_ENV",
  "REVOLUT_CLIENT_ID",
  "REVOLUT_PRIVATE_KEY_PATH",
  "REVOLUT_JWT_ISS",
  "REVOLUT_OPERATOR",
  "REVOLUT_TOKEN_DIR",
];

let dir;
let keyPath;
let badKeyPath;

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "revolut-cfg-"));
  keyPath = path.join(dir, "key.pem");
  writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n");
  badKeyPath = path.join(dir, "notakey.txt");
  writeFileSync(badKeyPath, "just some text");
});

function clearEnv() {
  for (const v of REVOLUT_VARS) delete process.env[v];
}

function setValid(overrides = {}) {
  clearEnv();
  process.env.REVOLUT_CLIENT_ID = "cid";
  process.env.REVOLUT_PRIVATE_KEY_PATH = keyPath;
  process.env.REVOLUT_JWT_ISS = "example.com";
  process.env.REVOLUT_OPERATOR = "alice";
  process.env.REVOLUT_TOKEN_DIR = dir;
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

afterEach(() => clearEnv());

describe("loadConfig", () => {
  it("defaults to sandbox with the sandbox base URLs", () => {
    setValid();
    const cfg = loadConfig();
    assert.equal(cfg.env, "sandbox");
    assert.equal(cfg.apiBaseUrl, "https://sandbox-b2b.revolut.com/api/1.0");
    assert.equal(cfg.webAppUrl, "https://sandbox-business.revolut.com");
    assert.match(cfg.tokenStorePath, /tokens-sandbox\.json$/);
  });

  it("selects production only when explicitly set", () => {
    setValid({ REVOLUT_ENV: "production" });
    const cfg = loadConfig();
    assert.equal(cfg.env, "production");
    assert.equal(cfg.apiBaseUrl, "https://b2b.revolut.com/api/1.0");
    assert.match(cfg.tokenStorePath, /tokens-production\.json$/);
  });

  it("rejects an unknown REVOLUT_ENV", () => {
    setValid({ REVOLUT_ENV: "staging" });
    assert.throws(() => loadConfig(), /REVOLUT_ENV/);
  });

  it("strips a scheme from REVOLUT_JWT_ISS", () => {
    setValid({ REVOLUT_JWT_ISS: "https://example.com" });
    assert.equal(loadConfig().jwtIss, "example.com");
  });

  it("throws when REVOLUT_CLIENT_ID is missing", () => {
    setValid({ REVOLUT_CLIENT_ID: undefined });
    assert.throws(() => loadConfig(), /REVOLUT_CLIENT_ID/);
  });

  it("throws when REVOLUT_OPERATOR is empty", () => {
    setValid({ REVOLUT_OPERATOR: "   " });
    assert.throws(() => loadConfig(), /REVOLUT_OPERATOR/);
  });

  it("throws when the private key file is missing", () => {
    setValid({ REVOLUT_PRIVATE_KEY_PATH: path.join(dir, "nope.pem") });
    assert.throws(() => loadConfig(), /private key/i);
  });

  it("throws when the private key file is not a PEM key", () => {
    setValid({ REVOLUT_PRIVATE_KEY_PATH: badKeyPath });
    assert.throws(() => loadConfig(), /PEM/);
  });
});
