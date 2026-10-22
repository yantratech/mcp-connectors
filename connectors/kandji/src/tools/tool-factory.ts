import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { CheckTools } from "./check/index.js";
import { DeviceTools } from "./devices/index.js";
import { PrismTools } from "./prism/index.js";
import { AuditTools } from "./audit/index.js";
import { UserTools } from "./users/index.js";
import { BlueprintTools } from "./blueprints/index.js";
import { BlueprintRoutingTools } from "./blueprint-routing/index.js";
import { VulnerabilityTools } from "./vulnerabilities/index.js";
import { LibraryTools } from "./library/index.js";
import { ThreatTools } from "./threats/index.js";
import { TagTools } from "./tags/index.js";
import { SettingsTools } from "./settings/index.js";
import { AdeTools } from "./ade/index.js";

export function ToolFactory(server: McpServer) {
  const allToolGroups = [
    CheckTools,
    DeviceTools,
    PrismTools,
    AuditTools,
    UserTools,
    BlueprintTools,
    BlueprintRoutingTools,
    VulnerabilityTools,
    LibraryTools,
    ThreatTools,
    TagTools,
    SettingsTools,
    AdeTools,
  ];

  for (const group of allToolGroups) {
    for (const factory of group) {
      const tool = factory();
      // Register with a STRICT object schema. Passing the raw shape to
      // server.tool() lets the SDK wrap it in a default z.object, which
      // silently STRIPS unknown argument keys before the handler runs — a
      // caller that misspells a field, or passes one the tool doesn't
      // support, gets a success response while the value never reaches the
      // handler or the Kandji API. .strict() turns that into a -32602
      // validation error naming the unrecognized key. Explicit JSON nulls
      // on .nullable() fields still reach handlers unchanged.
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: z.object(tool.schema as z.ZodRawShape).strict(),
          ...(tool.annotations ? { annotations: tool.annotations } : {}),
        },
        tool.handler as Parameters<typeof server.registerTool>[2],
      );
    }
  }
}
