# OpenAI Agents SDK example

A minimal agent that uses `@yantratech/xero-mcp-server` through the [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/). The script starts the MCP server itself, over stdio.

**The example is read-only by design.** It passes a static tool filter, so the agent sees six read tools (`list_organisation_details`, `list_accounts`, `list_contacts`, `get_contact`, `list_invoices` and `get_invoice`) out of the 148 the server registers by default. It cannot create, approve, void or delete anything. Even so, run it against the Xero **Demo Company** (see [Mode 1: Custom Connections](../../README.md#mode-1-custom-connections-recommended)), not a live organisation: the agent sends what it reads, including contact details, to OpenAI's API.

## Setup

Install Node.js 22 or later (`npx` ships with npm) and the Agents SDK:

```bash
pip install openai-agents
```

Set the credentials:

```bash
export XERO_CLIENT_ID=your_xero_client_id
export XERO_CLIENT_SECRET=your_xero_client_secret
export OPENAI_API_KEY=your_openai_api_key
```

> **npm publication is in progress.** Until `@yantratech/xero-mcp-server` is live on the npm registry, the script's default `npx` command will not resolve. Build the server from source (see [Installation](../../README.md#installation)) and point the script at the build:
>
> ```bash
> export XERO_MCP_SERVER_PATH=/absolute/path/to/mcp-connectors/connectors/xero/dist/index.js
> ```
>
> With `XERO_MCP_SERVER_PATH` set, the script starts the server with `node` and that path instead of `npx`.

## Run

```bash
python main.py
```

The script asks for a question, such as "List my contacts" or "What is the status of invoice INV-0001?", and prints the agent's answer.

## Notes

- **Tools.** To give the agent more tools, add their names to `ALLOWED_TOOLS` in `main.py`; [COVERAGE.md](../../COVERAGE.md) lists them all. Before you add a tool that writes to Xero, pass `require_approval` to `MCPServerStdio` and handle the approval requests it raises, so that a person approves every write (see the SDK's [MCP guide](https://openai.github.io/openai-agents-python/mcp/)), and keep using the Demo Company.
- **Model.** The script uses the Agents SDK's default model. Set `OPENAI_DEFAULT_MODEL` to use a different one.
- **Tracing.** The script turns off Agents SDK tracing, which is on by default and would store tool inputs and outputs in the OpenAI Traces dashboard. If you turn it back on, consider `RunConfig(trace_include_sensitive_data=False)`.
