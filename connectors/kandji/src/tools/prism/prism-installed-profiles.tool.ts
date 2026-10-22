import { makePrismTool } from "./_shared.js";

const PrismInstalledProfilesTool = makePrismTool(
  "prism_installed_profiles",
  "installed_profiles",
  "Get all installed configuration profiles across the entire fleet via Prism. Returns profiles on all device types including those NOT installed by Kandji. Use this for profile audit — verify expected profiles are present and detect unauthorized or stale profiles.",
);

export default PrismInstalledProfilesTool;
