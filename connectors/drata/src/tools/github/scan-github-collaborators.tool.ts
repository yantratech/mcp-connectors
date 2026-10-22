import { z } from "zod";
import { scanCollaborators } from "../../handlers/github-scan.handler.js";
import { CreateDrataTool } from "../../helpers/create-drata-tool.js";

const ScanGitHubCollaboratorsTool = CreateDrataTool(
  "scan_github_collaborators",
  "List collaborators and their permissions on a GitHub repository (access-control audits and SOC 2 evidence). Requires the GITHUB_PAT environment variable; `owner` defaults to the org of the Drata GitHub connection when omitted.",
  {
    owner: z
      .string()
      .optional()
      .describe("Repository owner (user or org). Defaults to the Drata-connected GitHub org."),
    repo: z.string().describe("Repository name"),
  },
  async ({ owner, repo }) => {
    const response = await scanCollaborators(owner, repo);

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

export default ScanGitHubCollaboratorsTool;
