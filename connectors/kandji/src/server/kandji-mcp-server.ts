import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getPackageVersion } from "../helpers/package-version.js";

export class KandjiMcpServer {
  private static instance: McpServer | null = null;

  private constructor() {}

  public static GetServer(): McpServer {
    if (KandjiMcpServer.instance === null) {
      KandjiMcpServer.instance = new McpServer({
        name: "yantratech-kandji-mcp-server",
        version: getPackageVersion(),
      });
    }
    return KandjiMcpServer.instance;
  }
}
