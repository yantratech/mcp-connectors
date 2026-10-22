import { z } from "zod";
import { scanGitHubRepos } from "../../handlers/github-scan.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ScanGitHubReposTool = CreateDrataTool(
  "scan_github_repos",
  "List GitHub repositories for an organization or the authenticated user (visibility, default branch, archive status). Requires the GITHUB_PAT environment variable (Drata's public API does not expose raw repo data); if omitted, `org` defaults to the org of the Drata GitHub connection.",
  {
    org: z
      .string()
      .optional()
      .describe(
        "GitHub organization name. Defaults to the Drata-connected GitHub org; falls back to repos accessible to the authenticated PAT.",
      ),
  },
  async ({ org }) => {
    const response = await scanGitHubRepos(org);

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

export default ScanGitHubReposTool;
