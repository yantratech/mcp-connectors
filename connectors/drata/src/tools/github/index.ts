import ScanGitHubReposTool from "./scan-github-repos.tool.js";
import ScanGitHubBranchProtectionTool from "./scan-github-branch-protection.tool.js";
import ScanGitHubVulnerabilitiesTool from "./scan-github-vulnerabilities.tool.js";
import ScanGitHubCollaboratorsTool from "./scan-github-collaborators.tool.js";

export const GitHubTools = [
  ScanGitHubReposTool,
  ScanGitHubBranchProtectionTool,
  ScanGitHubVulnerabilitiesTool,
  ScanGitHubCollaboratorsTool,
];
