import { z } from "zod";
import { scanVulnerabilities } from "../../handlers/github-scan.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ScanGitHubVulnerabilitiesTool = CreateDrataTool(
  "scan_github_vulnerabilities",
  "Scan a GitHub repository for Dependabot vulnerability alerts (severity breakdown and alert details). Requires the GITHUB_PAT environment variable (with security_events / Dependabot-alerts read); `owner` defaults to the org of the Drata GitHub connection when omitted.",
  {
    owner: z
      .string()
      .optional()
      .describe("Repository owner (user or org). Defaults to the Drata-connected GitHub org."),
    repo: z.string().describe("Repository name"),
    state: z
      .enum(["open", "fixed", "dismissed"])
      .optional()
      .describe('Alert state filter (defaults to "open")'),
  },
  async ({ owner, repo, state }) => {
    const response = await scanVulnerabilities(owner, repo, state);

    if (response.isError) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${response.error}` }],
      };
    }

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(response.result, null, 2) },
      ],
    };
  },
);

export default ScanGitHubVulnerabilitiesTool;
