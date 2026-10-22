"""Read-only Xero agent built with the OpenAI Agents SDK.

The agent can call only the read tools listed in ALLOWED_TOOLS, so it cannot
create, change or delete anything in Xero. Run it against the Xero Demo
Company, not a live organisation.
"""

import asyncio
import os
import shutil

from agents import Agent, Runner, set_tracing_disabled
from agents.mcp import MCPServer, MCPServerStdio, create_static_tool_filter

# The only tools the agent can see. Every other tool the server offers,
# including all write, void and delete tools, is hidden from the model.
ALLOWED_TOOLS = [
    "list_organisation_details",
    "list_accounts",
    "list_contacts",
    "get_contact",
    "list_invoices",
    "get_invoice",
]

# Tracing is on by default in the Agents SDK and would store tool inputs and
# outputs, which contain accounting data, in the OpenAI Traces dashboard.
set_tracing_disabled(True)


def server_command() -> tuple[str, list[str]]:
    """Return the command and arguments that start the Xero MCP server.

    Until @yantratech/xero-mcp-server is published to npm, build the server
    from source and set XERO_MCP_SERVER_PATH to the absolute path of
    connectors/xero/dist/index.js.
    """
    local_build = os.environ.get("XERO_MCP_SERVER_PATH")
    if local_build:
        return "node", [local_build]
    return "npx", ["-y", "@yantratech/xero-mcp-server"]


async def run(mcp_server: MCPServer) -> None:
    agent = Agent(
        name="Xero assistant",
        instructions=(
            "You answer questions about a Xero organisation using read-only "
            "tools. You cannot create, change or delete anything in Xero."
        ),
        mcp_servers=[mcp_server],
    )

    message = input("Ask about your Xero organisation (e.g. 'List my contacts'): ")
    print(f"Running: {message}")
    result = await Runner.run(starting_agent=agent, input=message)
    print(result.final_output)


async def main() -> None:
    command, args = server_command()
    if not shutil.which(command):
        raise RuntimeError(
            f"{command} not found. Install Node.js 22 or later (npx ships with npm)."
        )

    async with MCPServerStdio(
        name="Xero",
        params={
            "command": command,
            "args": args,
            "env": {
                "XERO_CLIENT_ID": os.environ["XERO_CLIENT_ID"],
                "XERO_CLIENT_SECRET": os.environ["XERO_CLIENT_SECRET"],
            },
        },
        tool_filter=create_static_tool_filter(allowed_tool_names=ALLOWED_TOOLS),
    ) as server:
        await run(server)


if __name__ == "__main__":
    asyncio.run(main())
