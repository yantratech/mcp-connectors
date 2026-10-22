import { makePrismTool } from "./_shared.js";

const PrismGatekeeperAndXProtectTool = makePrismTool(
  "prism_gatekeeper_and_xprotect",
  "gatekeeper_and_xprotect",
  "Get Gatekeeper and XProtect status across all macOS devices via Prism. Returns Gatekeeper enforcement status and XProtect definition versions. Identifies devices with outdated malware definitions or disabled Gatekeeper — both security risks.",
);

export default PrismGatekeeperAndXProtectTool;
