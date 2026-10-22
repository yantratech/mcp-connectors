import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getPackageVersion } from "../helpers/package-version.js";

export class DrataMcpServer {
  private static instance: McpServer | null = null;

  private constructor() {}

  public static GetServer(): McpServer {
    if (DrataMcpServer.instance === null) {
      DrataMcpServer.instance = new McpServer({
        name: "yantratech-drata-mcp-server",
        version: getPackageVersion(),
      });
    }
    return DrataMcpServer.instance;
  }
}
