import { makePrismTool } from "./_shared.js";

const PrismApplicationFirewallTool = makePrismTool(
  "prism_application_firewall",
  "application_firewall",
  "Get Application Firewall status across all macOS devices via Prism. Returns whether the macOS firewall is enabled, in stealth mode, or blocking incoming connections for each device. Important for SOC 2 and CIS benchmark compliance.",
);

export default PrismApplicationFirewallTool;
