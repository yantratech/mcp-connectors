# Contributing

Thanks for your interest in contributing. This document covers how the
monorepo is laid out, how to get a development environment running, and the
conventions we hold pull requests to.

## Repository layout

```
connectors/
  drata/          @yantratech/drata-mcp-server
  kandji/         @yantratech/kandji-mcp-server
  revolut/        @yantratech/revolut-mcp-server
  xero/           @yantratech/xero-mcp-server
  yantra-spend/   @yantratech/yantra-spend-mcp-server
```

Each connector is an independent npm package (managed as an npm workspace)
that builds to a standalone stdio MCP server. There is intentionally no shared
runtime package yet; each connector vendors its own client and helpers so it
can be installed and audited in isolation.

## Development setup

Requirements: Node.js ≥ 22, npm ≥ 10.

```bash
git clone https://github.com/yantratech/mcp-connectors.git
cd mcp-connectors
npm install        # installs all workspaces, builds each package (prepare)
npm run build      # rebuild everything
```

Per-package commands (replace `drata` with any connector):

```bash
npm run build --workspace=connectors/drata
npm test      --workspace=connectors/drata   # offline; no credentials needed
npm run lint  --workspace=connectors/drata
```

The offline test suites must pass with **no credentials configured** — they
run against local mock servers. Tests that hit real APIs live in `test/live-*`
files, are never run by `npm test`, and require explicit env vars (and, for
write paths, an explicit opt-in flag) to do anything.

## Conventions

**Tool naming.** MCP tool names are `snake_case` (`list_devices`,
`create_invoice`). Prefer verb-first names: `list_`, `get_`, `create_`,
`update_`, `delete_`, `check_`, `scan_`. Report-style tools may instead be
named for what they return (`spend_summary`, `prism_filevault`).

**Tool annotations.** Every tool declares MCP `ToolAnnotations`
(`readOnlyHint`, `destructiveHint`, `idempotentHint`) that truthfully describe
its behaviour. A tool that creates server-side state is not read-only, even if
it feels harmless.

**Error shape.** Tool handlers return failures as MCP results with
`isError: true` and a single human-readable message; never throw raw
exceptions across the MCP boundary, and never report a failure as a successful
result.

**Credentials.** Read credentials from environment variables (loading them
from a local `.env` file is fine). A connector that has to persist OAuth
tokens, as Revolut does, keeps them in a local file and documents where in its
README. No defaults that point at any real tenant. Nothing tenant-specific in
committed code, comments, tool descriptions, or test fixtures — synthetic data
uses `example.com`.

**TypeScript.** `strict` is on in every package and stays on. Lint
(`npm run lint`) must be clean. No `any`, `@ts-ignore`, or `eslint-disable`
without a comment explaining why.

**Tests.** A change to a tool or handler comes with an offline test. Each
package has a smoke test asserting the exact tool list; if you add or rename a
tool, update it deliberately.

## Pull requests

- Keep PRs focused — one concern per PR.
- Describe before/after behaviour in the description.
- Breaking changes to any tool name, parameter, or response shape must be
  called out in a **BREAKING** section of the PR description.
- CI (build + test + lint on Node 22 and 24) must be green.
- List every deleted or moved file in the PR description, so reviewers can
  check that nothing still refers to the old path.

## Adding a new connector

1. Create `connectors/<name>/` with `package.json` named
   `@yantratech/<name>-mcp-server`, `src/`, `test/`, `tsconfig.json`
   (strict), and the shared flat ESLint config pattern.
2. Follow the structure of an existing connector: `src/index.ts` entry,
   `src/clients/` for the API client, `src/tools/` for tool definitions,
   `src/handlers/` for logic.
3. Add an offline test suite with a mock API server and a smoke test that
   asserts the full tool list.
4. Write a README covering: what it does, install, env vars, Claude Desktop
   and Claude Code config, the full tool list, and a worked example.
5. Run `npm install` from the root to link the workspace; add the package to
   the root README status table.

## Reporting issues

Bugs and feature requests: [GitHub issues](https://github.com/yantratech/mcp-connectors/issues).
Security vulnerabilities: see [SECURITY.md](./SECURITY.md) — please do not
open public issues for those.

## Code of conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md).
