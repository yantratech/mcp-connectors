import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getPackageVersion } from "../helpers/get-package-version.js";

export class XeroMcpServer {
  private static instance: McpServer | null = null;

  private constructor() {}

  public static GetServer(): McpServer {
    if (XeroMcpServer.instance === null) {
      XeroMcpServer.instance = new McpServer({
        name: "yantratech-xero-mcp-server",
        version: getPackageVersion(),
      });
    }
    return XeroMcpServer.instance;
  }
}
