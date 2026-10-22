import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  XERO_JOURNAL_TOOL_NAMES,
  XERO_RECEIPT_TOOL_NAMES,
  journalsEnabled,
  receiptsEnabled,
} from "../consts/xero-scopes.js";

import { CreateTools } from "./create/index.js";
import { DeleteTools } from "./delete/index.js";
import { DownloadTools } from "./download/index.js";
import { GetTools } from "./get/index.js";
import { ListTools } from "./list/index.js";
import { UpdateTools } from "./update/index.js";

export function ToolFactory(server: McpServer) {
  const allTools = [
    ...DeleteTools,
    ...DownloadTools,
    ...GetTools,
    ...CreateTools,
    ...ListTools,
    ...UpdateTools,
  ];

  // Receipt tools need the deprecated accounting.transactions scopes and the
  // journal tools need accounting.journals.read; each set is requested only
  // on opt-in (see src/consts/xero-scopes.ts).
  const withReceipts = receiptsEnabled();
  const withJournals = journalsEnabled();

  for (const factory of allTools) {
    const tool = factory();
    if (!withReceipts && XERO_RECEIPT_TOOL_NAMES.includes(tool.name)) continue;
    if (!withJournals && XERO_JOURNAL_TOOL_NAMES.includes(tool.name)) continue;
    if (tool.annotations) {
      server.tool(
        tool.name,
        tool.description,
        tool.schema,
        tool.annotations,
        tool.handler,
      );
    } else {
      server.tool(tool.name, tool.description, tool.schema, tool.handler);
    }
  }
}
