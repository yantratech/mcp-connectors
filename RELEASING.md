# Releasing

How the packages in this monorepo are versioned and published to npm. Each
connector is an independent package with its own version.

## Publish flow

Maintainers publish from a clone of this repository
(`github.com/yantratech/mcp-connectors`), so that every published version and
its tag point at a commit on this repository's `main`.

1. In a pull request, bump the package's version (see the versioning policy
   below) and update its README if the tool surface or configuration changed.
   `npm version <version> --workspace=connectors/<name>` updates both the
   package's `package.json` and `package-lock.json`. Merge once CI is green.
2. Once CI is green on `main`, check out `main` as it is on GitHub, with a
   clean working tree, then build, test and publish from the repo root:

   ```bash
   git remote -v                     # origin must be github.com/yantratech/mcp-connectors
   git fetch origin
   git switch --detach origin/main
   npm ci
   npm run build --workspace=connectors/<name>
   npm test      --workspace=connectors/<name>
   npm pack --workspace=connectors/<name> --dry-run   # read the file list!
   npm publish --workspace=connectors/<name> --access public
   ```

   `--access public` is required for the first publish of any `@yantratech/*`
   scoped package.
3. Tag that commit and push only that tag:

   ```bash
   git tag @yantratech/<name>-mcp-server@<version>
   git push origin refs/tags/@yantratech/<name>-mcp-server@<version>
   ```

   Never use `git push --tags` or `git push --mirror`: `--tags` pushes every
   tag in your clone and `--mirror` every ref, including any that were never
   meant to be public.
4. Create a GitHub release from the tag, with release notes that describe the
   changes and call out anything breaking.

## Publish checklist

- `npm pack --dry-run` file list contains `dist/`, `README.md`, `LICENSE` and
  **nothing else** (no tests, no internal docs, no maps you didn't intend).
  CI's "Check npm tarball contents" step enforces the first half (LICENSE,
  README.md, dist/ and every bin target) for every non-private package; the
  "nothing else" half is still a manual read of the file list.
- README install/config instructions work against the version being published.
- On a package's first publish, remove the "npm publication is in progress"
  note from its README (and from the root README once every package is on
  npm).
- The tool list in the README matches the server's `tools/list` response
  exactly.
- No new dependency advisories: `npm audit --omit=dev` at the package.

## Versioning policy

- The MCP tool surface (names, parameters, response shapes) is the public API.
- Removing or renaming a tool, or changing a parameter's meaning: **major**
  (pre-1.0: minor, called out in the release notes).
- Adding tools or optional parameters: minor.
- Bug fixes that change observable behaviour from wrong to documented: patch,
  with release notes describing the before/after.
