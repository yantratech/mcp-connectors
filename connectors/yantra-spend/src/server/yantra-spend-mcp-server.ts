import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getPackageVersion } from "../helpers/package-version.js";

export class YantraSpendMcpServer {
  private static instance: McpServer | null = null;

  private constructor() {}

  public static GetServer(): McpServer {
    if (YantraSpendMcpServer.instance === null) {
      YantraSpendMcpServer.instance = new McpServer({
        name: "yantratech-yantra-spend-mcp-server",
        version: getPackageVersion(),
      });
    }
    return YantraSpendMcpServer.instance;
  }

  public static ResetForTests(): void {
    YantraSpendMcpServer.instance = null;
  }
}
