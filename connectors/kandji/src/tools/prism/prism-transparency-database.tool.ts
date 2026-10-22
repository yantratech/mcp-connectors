import { makePrismTool } from "./_shared.js";

const PrismTransparencyDatabaseTool = makePrismTool(
  "prism_transparency_database",
  "transparency_database",
  "Get Transparency, Consent, and Control (TCC/PPPC) database entries from macOS devices via Prism. Returns privacy permission grants for apps — which apps have access to camera, microphone, screen recording, full disk access, etc. One row per grant per device; the DEFAULT RESPONSE IS A CAPPED 20-ROW SLICE, not the whole fleet (page with max_results). Use for privacy and security auditing.",
);

export default PrismTransparencyDatabaseTool;
