import { makePrismTool } from "./_shared.js";

const PrismLaunchAgentsAndDaemonsTool = makePrismTool(
  "prism_launch_agents_and_daemons",
  "launch_agents_and_daemons",
  "Get Launch Agents and Launch Daemons from macOS devices via Prism. Returns launchd services with their label, path, and run status — one row per service per device, and the DEFAULT RESPONSE IS A CAPPED 20-ROW SLICE, not the whole fleet (page with max_results). Use for detecting unauthorized background processes or verifying required agents are running.",
);

export default PrismLaunchAgentsAndDaemonsTool;
