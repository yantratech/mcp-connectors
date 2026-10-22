/**
 * The package exposes two executables: the MCP server and the one-time
 * `revolut-mcp-authorize` code exchange. npm users have no `npm run` script to
 * fall back on, so the authorize step is only reachable through its bin.
 *
 * Run: node --test test/package-bin.test.mjs (after npm run build)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));

describe("package bins", () => {
  it("maps the server and the authorize CLI", () => {
    assert.deepEqual(pkg.bin, {
      "revolut-mcp-server": "dist/index.js",
      "revolut-mcp-authorize": "dist/bin/authorize.js",
    });
  });

  it("keeps the server bin named after the package, so `npx @yantratech/revolut-mcp-server` runs it", () => {
    assert.equal(pkg.bin[pkg.name.split("/")[1]], "dist/index.js");
  });

  for (const [name, target] of Object.entries(pkg.bin)) {
    it(`${name} is an executable node script`, () => {
      const file = path.join(pkgDir, target);
      assert.ok(readFileSync(file, "utf8").startsWith("#!/usr/bin/env node\n"), `${target} lacks a node shebang`);
      if (process.platform !== "win32") {
        assert.ok(statSync(file).mode & 0o111, `${target} is not executable`);
      }
    });
  }

  it("revolut-mcp-authorize with no code prints usage naming the bin and exits 2", () => {
    const result = spawnSync(process.execPath, [path.join(pkgDir, pkg.bin["revolut-mcp-authorize"])], {
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage: revolut-mcp-authorize <code>/);
    assert.match(result.stderr, /npx -y -p @yantratech\/revolut-mcp-server revolut-mcp-authorize <code>/);
    assert.match(result.stderr, /npm run authorize -- <code>/);
  });
});
