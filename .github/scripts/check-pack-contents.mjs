#!/usr/bin/env node
/**
 * Fails when a publishable workspace's npm tarball would be missing LICENSE,
 * README.md, its dist/ build or a bin target.
 *
 * Reads the JSON that `npm pack --dry-run --json --workspaces` prints (from a
 * file argument, or stdin) and checks every workspace whose package.json is not
 * `"private": true`. npm never adds the workspace root's LICENSE to a package
 * tarball, so each package must carry its own; a version published without one
 * cannot be fixed afterwards. Run it after the build, so dist/ exists.
 *
 * Usage:
 *   npm pack --dry-run --json --workspaces --ignore-scripts > pack.json
 *   node .github/scripts/check-pack-contents.mjs pack.json
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const input = process.argv[2] ? readFileSync(process.argv[2], "utf8") : readFileSync(0, "utf8");
const packs = JSON.parse(input);
if (!Array.isArray(packs) || packs.length === 0) {
  console.error("check-pack-contents: expected a non-empty JSON array from npm pack --json");
  process.exit(2);
}
const packed = new Map(packs.map((p) => [p.name, new Set(p.files.map((f) => f.path))]));

const root = process.cwd();
const rootPkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const workspaceDirs = rootPkg.workspaces.flatMap((pattern) => {
  if (!pattern.endsWith("/*")) return [pattern];
  const parent = pattern.slice(0, -2);
  return readdirSync(path.join(root, parent), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `${parent}/${e.name}`);
});

const problems = [];
let checked = 0;
for (const dir of workspaceDirs) {
  const pkg = JSON.parse(readFileSync(path.join(root, dir, "package.json"), "utf8"));
  if (pkg.private === true) {
    console.log(`skip  ${pkg.name} (private)`);
    continue;
  }
  const files = packed.get(pkg.name);
  if (!files) {
    problems.push(`${pkg.name}: not in the npm pack output`);
    continue;
  }
  checked += 1;
  const missing = [];
  if (!files.has("LICENSE")) missing.push("LICENSE");
  if (!files.has("README.md")) missing.push("README.md");
  if (![...files].some((f) => f.startsWith("dist/"))) missing.push("dist/");
  const bins = typeof pkg.bin === "string" ? [pkg.bin] : Object.values(pkg.bin ?? {});
  for (const bin of bins) {
    const rel = path.posix.normalize(bin);
    if (!files.has(rel)) missing.push(`bin ${rel}`);
  }
  if (missing.length > 0) problems.push(`${pkg.name}: missing ${missing.join(", ")}`);
  else console.log(`ok    ${pkg.name} (${files.size} files)`);
}

if (checked === 0) problems.push("no publishable workspace was checked");
if (problems.length > 0) {
  for (const p of problems) console.error(`FAIL  ${p}`);
  process.exit(1);
}
