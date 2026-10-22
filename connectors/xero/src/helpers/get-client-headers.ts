import { getPackageVersion } from "./get-package-version.js";

export const getClientHeaders = () => {
  return {
    headers: {
      "user-agent": `yantratech-xero-mcp-server/${getPackageVersion()} (+https://github.com/yantratech/mcp-connectors)`,
    },
  };
};
