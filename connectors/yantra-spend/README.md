# @yantratech/yantra-spend-mcp-server

Façade MCP server for engineering and infrastructure spend across **AWS, Azure, Anthropic, OpenAI and Cursor**. GCP is not supported.

USD is canonical on every cost line. GBP conversion is opt-in per call and cached 60s in-process. The server is stateless — no local persistence of cost data; provider APIs hold the history.

## Why this exists

Each cloud, LLM and IDE vendor has its own billing surface. Asking _"what did we spend this week?"_ today means stitching together five different consoles or five different MCP tool surfaces. `yantra-spend` wraps the read-only billing surface of each provider via its canonical SDK or admin API and exposes six read-only tools with a uniform `CostLine` shape.

This server deliberately does **not** mirror full vendor MCP surfaces (resource management, IAM, provisioning). Those stay available via the official AWS Labs / Microsoft / Google MCPs alongside this one. `yantra-spend` answers routine cross-provider spend questions; vendor MCPs remain for power-user drill-downs.

## Tool surface

| Tool | Inputs | Returns |
|---|---|---|
| `spend_summary` | `start, end, currency=USD, include_raw=false`† | Per-source totals, grand total, week-over-week delta, `partial` flag, warnings |
| `spend_by_source` | `source, start, end, group_by?, currency=USD, include_raw=false, limit=150` | Normalised cost lines, with line counts, a `truncated` flag and warnings |
| `top_movers` | `start, end, limit=5, currency=USD` | Cross-source list of largest WoW increases |
| `anomalies` | `window_days=7, include_raw=false` | Provider-detected anomalies (AWS only) |
| `forecast_month_end` | `currency=USD, include_raw=false` | Per-source month-end forecast where supported (AWS, Azure) |
| `health` | `probe=false` | Per-source availability (see below) |

`include_raw` controls the provider-original `raw` blob: it is omitted by default and attached to every cost line / anomaly / forecast entry when `include_raw=true`. † On `spend_summary` the flag is accepted but reserved for forward compatibility — the tool returns per-source totals only and surfaces no `raw` blobs today.

`health` with `probe=false` (the default) returns a flat `{ aws, gcp, azure, anthropic, openai, cursor } → bool` map reflecting env-var presence only. With `probe=true` it makes one cheap API call per available source (yesterday's window for the AWS/Azure/Anthropic/OpenAI cost endpoints; for Cursor, a one-event `POST /teams/filtered-usage-events` over the last 24h — the same endpoint its cost queries use) and returns `{ available: bool, reachable: bool, error?: string, missing_env?: string[] }` per source — distinguishing "no credentials" from "creds present but API unreachable". For an unavailable source, `missing_env` lists the variables to set.

Failed tool calls return an MCP tool result with `isError: true` and a human-readable error message.

### Cost-line shape

```json
{
  "source": "cursor",
  "period_start": "2026-05-01T00:00:00.000Z",
  "period_end": "2026-05-02T00:00:00.000Z",
  "amount_usd": 12.34,
  "amount_gbp": 9.7486,
  "group_by_field": "user",
  "group_by_value": "user@example.com",
  "raw": { "...": "provider-original sample event" }
}
```

`amount_usd` is always populated. `amount_gbp` is populated only when the caller passed `currency="GBP"`. The `raw` field is present only when the caller passed `include_raw=true`.

## Source-specific group_by axes

| Source | Axes |
|---|---|
| `aws` | `service` (default), `region`, `account`, `usage_type`, `tag:project`, `tag:env`, `tag:owner` |
| `azure` | `service` (default), `resource_group`, `resource`, `meter`, `subscription` |
| `anthropic` | `workspace_id`, `description` (default for `top_movers`) |
| `openai` | `project_id`, `line_item` (default), `api_key_id` |
| `cursor` | `user` (default — per-engineer attribution), `model`, `kind` |
| `gcp` | (not supported — empty) |

Cursor caps date ranges at **30 days per call** per the admin API; longer windows are auto-chunked server-side and concatenated — there is no user-facing 30-day cap.

## Architecture

```
                     ┌─────────────────────────────┐
   agent ── MCP ────▶│         yantra-spend        │
                     │           (façade)          │
                     └──────────────┬──────────────┘
                                    │
        ┌─────────────┬─────────────┼─────────────┬─────────────┐
        ▼             ▼             ▼             ▼             ▼
       AWS          Azure       Anthropic       OpenAI        Cursor
  Cost Explorer   Cost Mgmt     admin API     admin API     admin API
```

Each source implements the `SourceModule` interface (`src/sources/source-module.ts`):

- `name`
- `requiredEnv` — the variables `health` lists in `missing_env`
- `isAvailable()`
- `getCostLines(start, end, groupBy?)`
- `getAnomalies(windowDays)`
- `getForecastToMonthEnd()`
- `probe()` — the reachability check behind `health` with `probe=true`

Sources read their own credentials from `process.env` and disable themselves when the credentials are absent. Missing credentials never cause an error: the source is skipped, and `spend_summary`, `spend_by_source` and `forecast_month_end` say so in their response.

## Quick start

```bash
# from the monorepo root
npm install
cp connectors/yantra-spend/.env.example connectors/yantra-spend/.env  # fill in creds
npm run build --workspace=connectors/yantra-spend
node connectors/yantra-spend/dist/index.js   # runs MCP over stdio
```

When it runs from a source checkout like this, the connector loads `connectors/yantra-spend/.env` on startup. The path is resolved relative to `dist/index.js`, not the working directory, so it works whichever directory the MCP client starts the server from. With credentials in `.env`, the client config's `env` block can be omitted, and credentials can be rotated without editing the client config. Variables already set in the environment take precedence over `.env`.

> **npm publication is in progress.** Until the package is live on the npm registry, the `npx` commands below will not resolve. Run the server from source instead: use `node` as the command and `/path/to/mcp-connectors/connectors/yantra-spend/dist/index.js` as its argument (see Quick start above).
>
> Under `npx`, the package runs from npm's cache, which holds no `.env` file: a `.env` in your checkout or working directory is **not** read. Pass credentials through the MCP client's `env` block (`--env` flags for Claude Code) instead.

### Claude Code configuration

```bash
claude mcp add yantra-spend --env ANTHROPIC_ADMIN_KEY=YOUR_ADMIN_KEY --env CURSOR_ADMIN_API_KEY=YOUR_API_KEY -- npx -y @yantratech/yantra-spend-mcp-server
```

Pass any of the variables from `.env.example` via repeated `--env` flags (the full set is shown in the Claude Desktop block below). From a source checkout, replace `npx -y @yantratech/yantra-spend-mcp-server` with `node /path/to/mcp-connectors/connectors/yantra-spend/dist/index.js`; the `--env` flags can then be left out if `connectors/yantra-spend/.env` holds the credentials.

### Claude Desktop configuration

```json
{
  "mcpServers": {
    "yantra-spend": {
      "command": "npx",
      "args": ["-y", "@yantratech/yantra-spend-mcp-server"],
      "env": {
        "AWS_ACCESS_KEY_ID": "…",
        "AWS_SECRET_ACCESS_KEY": "…",
        "AZURE_TENANT_ID": "…",
        "AZURE_CLIENT_ID": "…",
        "AZURE_CLIENT_SECRET": "…",
        "AZURE_SUBSCRIPTION_IDS": "sub-1,sub-2",
        "ANTHROPIC_ADMIN_KEY": "sk-ant-admin-…",
        "OPENAI_ADMIN_KEY": "…",
        "OPENAI_ORG_ID": "org-…",
        "CURSOR_ADMIN_API_KEY": "…"
      }
    }
  }
}
```

Sources whose variables are missing are skipped: `health` shows which, and `spend_summary`, `spend_by_source` and `forecast_month_end` say so in their responses.

## Worked example

Asked _"What did we spend last week, and how does that compare with the week before?"_, an agent calls `spend_summary` with `{ "start": "2026-05-04", "end": "2026-05-11" }`. With AWS, Anthropic, OpenAI and Cursor configured and no Azure credentials, the response looks like this (figures are illustrative):

```json
{
  "period_start": "2026-05-04T00:00:00.000Z",
  "period_end": "2026-05-11T00:00:00.000Z",
  "currency": "USD",
  "grand_total_usd": 3348.41,
  "wow_delta_pct": 8.0132,
  "partial": true,
  "warnings": [
    "gcp: unsupported",
    "azure: skipped (no credentials)",
    "wow_delta_pct computed over: aws, anthropic, openai, cursor"
  ],
  "sources": [
    { "source": "aws", "amount_usd": 1234.56, "line_count": 7 },
    { "source": "gcp", "amount_usd": null, "line_count": null },
    { "source": "azure", "amount_usd": null, "line_count": null },
    { "source": "anthropic", "amount_usd": 842.1, "line_count": 7 },
    { "source": "openai", "amount_usd": 311.75, "line_count": 7 },
    { "source": "cursor", "amount_usd": 960, "line_count": 7 }
  ]
}
```

`partial` is `true` because GCP (not supported) and Azure (no credentials) contributed nothing. The week-over-week delta is still computed, over the four sources that returned data in both weeks, and the last warning names them. A follow-up `top_movers` call with the same window shows which services, models or users drove the change.

## IAM / setup artifacts

- `docs/iam/aws-readonly-policy.json` — least-privilege IAM policy: the three Cost Explorer read actions the connector calls
- `docs/iam/aws-readonly-setup.md` — `aws iam` commands to create a read-only IAM user
- `docs/iam/azure-sp-setup.md` — `az` commands to create the service principal, what the Cost Management Reader role grants, and a narrower custom role

Cursor and the LLM admin keys are single-credential — minted from the respective admin consoles. Note: the Cursor key is sent as the HTTP Basic-auth username (with an empty password), not as a Bearer token.

## Status

Read-only spend across five sources: AWS, Azure, Anthropic, OpenAI and Cursor. Anomaly detection covers AWS only; month-end forecasts cover AWS and Azure.

GCP is not supported. `health` reports it as unavailable (with `probe=true`, its `error` is `unsupported`), `spend_summary` and `spend_by_source` return no data for it with a `gcp: unsupported` warning, `forecast_month_end` lists it in `sources_skipped`, and `top_movers` and `anomalies` skip it.

## Contributing

Contributions welcome — see the repo-wide [CONTRIBUTING.md](../../CONTRIBUTING.md).

## License

[MIT](./LICENSE) © Yantra Applied Technologies Limited. Portions adapted from [XeroAPI/xero-mcp-server](https://github.com/XeroAPI/xero-mcp-server) (MIT, © 2025 Xero Limited).

Not affiliated with or endorsed by Amazon Web Services, Microsoft, Google, Anthropic, OpenAI or Cursor.
