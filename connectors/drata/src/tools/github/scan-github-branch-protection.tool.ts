import { z } from "zod";
import { scanBranchProtection } from "../../handlers/github-scan.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ScanGitHubBranchProtectionTool = CreateDrataTool(
  "scan_github_branch_protection",
  "Check branch protection rules for a GitHub repository (required reviews, status checks, force-push restrictions, admin enforcement). Requires the GITHUB_PAT environment variable; `owner` defaults to the org of the Drata GitHub connection when omitted.",
  {
    owner: z
      .string()
      .optional()
      .describe("Repository owner (user or org). Defaults to the Drata-connected GitHub org."),
    repo: z.string().describe("Repository name"),
    branch: z
      .string()
      .optional()
      .describe("Branch to check (defaults to the repo's default branch)"),
  },
  async ({ owner, repo, branch }) => {
    const response = await scanBranchProtection(owner, repo, branch);

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

export default ScanGitHubBranchProtectionTool;
