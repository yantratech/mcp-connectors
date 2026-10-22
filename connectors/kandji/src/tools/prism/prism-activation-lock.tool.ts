import { makePrismTool } from "./_shared.js";

const PrismActivationLockTool = makePrismTool(
  "prism_activation_lock",
  "activation_lock",
  "Get Activation Lock status across the entire fleet via Prism. Returns whether Activation Lock is enabled or disabled for each iOS, iPadOS, visionOS, and macOS device. Critical for compliance audits — devices with Activation Lock disabled may be at risk.",
);

export default PrismActivationLockTool;
