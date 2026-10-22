import ListVulnerabilitiesTool from "./list-vulnerabilities.tool.js";
import GetVulnerabilityTool from "./get-vulnerability.tool.js";
import GetVulnerabilityDevicesTool from "./get-vulnerability-devices.tool.js";
import GetVulnerabilitySoftwareTool from "./get-vulnerability-software.tool.js";
import ListVulnerabilityDetectionsTool from "./list-vulnerability-detections.tool.js";

export const VulnerabilityTools = [
  ListVulnerabilitiesTool,
  GetVulnerabilityTool,
  GetVulnerabilityDevicesTool,
  GetVulnerabilitySoftwareTool,
  ListVulnerabilityDetectionsTool,
];
