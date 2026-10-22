import { makePrismTool } from "./_shared.js";

const PrismStartupSettingsTool = makePrismTool(
  "prism_startup_settings",
  "startup_settings",
  "Get startup security settings across all macOS devices via Prism. Returns System Integrity Protection (SIP) status and Sealed System Volume (SSV) status. Devices with SIP disabled are a critical security finding for compliance audits.",
);

export default PrismStartupSettingsTool;
