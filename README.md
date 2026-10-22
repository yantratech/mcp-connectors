# Yantra MCP Connectors

[![CI](https://github.com/yantratech/mcp-connectors/actions/workflows/ci.yml/badge.svg)](https://github.com/yantratech/mcp-connectors/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

[MCP](https://modelcontextprotocol.io) servers from
[Yantra Applied Technologies](https://yantratech.com), which builds AI agents
for capital markets operations. We use these connectors to run our own
compliance, device-management, accounting and cloud-spend workflows through
agents.

Each connector is an independent npm package: a standalone stdio MCP server
you can wire into Claude Desktop, Claude Code, or any MCP client.

## Connectors

| Connector | Package | Tools | Status |
|-----------|---------|------:|--------|
| [Drata](./connectors/drata/) — SOC 2 / compliance automation | `@yantratech/drata-mcp-server` | 140 | Used in production at Yantra · pre-1.0 |
| [Iru Endpoint (formerly Kandji)](./connectors/kandji/) — Apple device management (MDM) | `@yantratech/kandji-mcp-server` | 114 | Used in production at Yantra · pre-1.0 |
| [Revolut Business](./connectors/revolut/) — read + payment drafts (never moves money) | `@yantratech/revolut-mcp-server` | 9 | Beta · no `PAY` scope, by design · sandbox by default |
| [Xero](./connectors/xero/) — accounting, payroll, fixed assets | `@yantratech/xero-mcp-server` | 148 (+5 opt-in) | Stable · used in production at Yantra |
| [Yantra Spend](./connectors/yantra-spend/) — cloud/AI spend façade | `@yantratech/yantra-spend-mcp-server` | 6 | Beta · read-only · GCP not supported |

Pre-1.0 packages follow the 0.x convention: a minor version can include
breaking changes (see [RELEASING.md](./RELEASING.md#versioning-policy)).

> **npm publication is in progress.** Until the packages are on the registry,
> run them from source (below) — the `npx` one-liners will work once
> published.

## Quick start (from source)

Requirements: Node.js ≥ 22.

```bash
git clone https://github.com/yantratech/mcp-connectors.git
cd mcp-connectors
npm install   # installs and builds every connector
```

Then point your MCP client at the built server. For Claude Code:

```bash
claude mcp add xero \
  --env XERO_CLIENT_ID=your_client_id \
  --env XERO_CLIENT_SECRET=your_client_secret \
  -- node /path/to/mcp-connectors/connectors/xero/dist/index.js
```

For Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "xero": {
      "command": "node",
      "args": ["/path/to/mcp-connectors/connectors/xero/dist/index.js"],
      "env": {
        "XERO_CLIENT_ID": "your_client_id",
        "XERO_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

Each connector's README documents its environment variables, full tool list
and client configuration. Credentials come from the environment; Xero and
Yantra Spend also load a `.env` file if one is present. Some connectors keep
local state on disk: Revolut stores its OAuth tokens (under `~/.revolut-mcp`
by default), and Drata can read an optional vendor-review state file under
`~/.local/state/drata-mcp`. Each connector's README says what it reads and
writes, and where.

## Development

```bash
npm run build                                  # build all connectors
npm test --workspaces --if-present             # offline test suites (no credentials needed)
npm run lint --workspaces                      # lint all connectors
npm run build --workspace=connectors/xero      # one connector
```

The offline suites run against local mock servers and pass with no
credentials configured. Live-API tests exist under `test/live-*` per package;
they are opt-in and never run in CI.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, conventions (tool naming,
error shapes, annotations), and how to add a new connector. Releases:
[RELEASING.md](./RELEASING.md). Security reports: [SECURITY.md](./SECURITY.md)
— please don't open public issues for vulnerabilities.

Bugs and feature requests → [GitHub issues](https://github.com/yantratech/mcp-connectors/issues).

## License

[MIT](./LICENSE) © Yantra Applied Technologies Limited.
The Xero connector began as a fork of
[XeroAPI/xero-mcp-server](https://github.com/XeroAPI/xero-mcp-server) (MIT)
and has been substantially extended. The Drata, Kandji and Yantra Spend
connectors reuse its server scaffolding, and the LICENSE file in each of
these four packages carries Xero Limited's copyright notice.

## Trademarks

Drata, Kandji, Iru, Revolut and Xero are trademarks of their respective
owners. These connectors are independent work by Yantra Applied Technologies
Limited and are not affiliated with or endorsed by those companies. Other
names mentioned in this repository may be trademarks of their respective
owners.
