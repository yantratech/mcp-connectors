import { makePrismTool } from "./_shared.js";

const PrismAppsTool = makePrismTool(
  "prism_apps",
  "apps",
  "Get application inventory across the fleet via Prism — app name, version, and bundle ID rows aggregated from macOS and iOS devices. One row per app per device, so the universe is large (thousands of rows on small fleets) and the DEFAULT RESPONSE IS A CAPPED 20-ROW SLICE, typically covering a single device — not the fleet. Use for software audit, license tracking, or detecting unapproved applications; for fleet-wide answers page with max_results or start from prism_count.",
);

export default PrismAppsTool;
