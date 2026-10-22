import { makePrismTool } from "./_shared.js";

const PrismSystemExtensionsTool = makePrismTool(
  "prism_system_extensions",
  "system_extensions",
  "Get system extensions across all macOS devices via Prism. Returns the modern system extensions (replacements for kexts) including network extensions, endpoint security extensions, and driver extensions with their team ID and state.",
);

export default PrismSystemExtensionsTool;
