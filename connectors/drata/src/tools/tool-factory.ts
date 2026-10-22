import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { CheckTools } from "./check/index.js";
import { GetTools } from "./get/index.js";
import { ListTools } from "./list/index.js";
import { WriteTools } from "./write/index.js";
import { V2Tools } from "./v2/index.js";
import { GitHubTools } from "./github/index.js";
import { groupForTool, unavailableMarker } from "../helpers/entitlements.js";

export interface ToolFactoryOptions {
  /** Ids of entitlement groups detected as unavailable on this plan. */
  unentitledGroups?: ReadonlySet<string>;
  /** When true, unentitled tools are not registered at all. */
  hideUnentitled?: boolean;
}

export function ToolFactory(
  server: McpServer,
  options: ToolFactoryOptions = {},
) {
  const unentitled = options.unentitledGroups ?? new Set<string>();
  const allTools = [
    ...CheckTools,
    ...GetTools,
    ...ListTools,
    ...WriteTools,
    ...V2Tools,
    ...GitHubTools,
  ];

  for (const factory of allTools) {
    const tool = factory();

    const group = groupForTool(tool.name);
    if (group && unentitled.has(group.id)) {
      // Drop entirely when the operator opted into a clean surface, else keep
      // the tool registered but prepend a loud unavailable marker so an LLM
      // caller can't mistake it for a working tool. Leaving it registered is
      // upgrade-safe: a later plan change auto-restores it with no code change.
      if (options.hideUnentitled) continue;
      tool.description = `${unavailableMarker(group)} ${tool.description}`;
    }

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
